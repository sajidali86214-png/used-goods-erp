import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { postExpense } from "../src/modules/finance/ledgerService.js";
import { lockPeriod, reopenPeriod } from "../src/modules/finance/periodLockService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

async function pkrAccount(label: string) {
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  return prisma.account.create({ data: { label, currencyId: pkr.id, kind: "bank" } });
}

describe("period lock: no posting into a locked period until it's reopened", () => {
  it("blocks a posting dated inside a locked period, then allows it once reopened", async () => {
    const bank = await pkrAccount(`Bank-${randomUUID()}`);
    const category = await prisma.expenseCategory.create({ data: { label: "Supplies" } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const user = await prisma.user.create({
      data: { name: "Period Lock Test User", email: `period-${randomUUID()}@example.com`, passwordHash: "x" },
    });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const lock = await lockPeriod({ periodStart, periodEnd, lockedByUserId: user.id });

    const expense = await prisma.expense.create({
      data: { date: now, payeeType: "other", categoryId: category.id, currencyId: pkr.id, amount: 1000, paymentStatus: "paid", accountId: bank.id },
    });

    await expect(postExpense(expense.id)).rejects.toThrow(/locked period/);

    const reopened = await reopenPeriod({ periodLockId: lock.id, reopenedByUserId: user.id, reason: "Correcting a missed expense entry" });
    expect(reopened.reopenedAt).not.toBeNull();

    const posted = await postExpense(expense.id);
    expect(posted).toHaveLength(2);

    const auditEvents = await prisma.auditEvent.findMany({
      where: { entityType: "PeriodLock", entityId: lock.id, action: "reopen_period" },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.reason).toMatch(/missed expense/);

    // A second reopen attempt is rejected — it's already reopened.
    await expect(
      reopenPeriod({ periodLockId: lock.id, reopenedByUserId: user.id, reason: "again" }),
    ).rejects.toThrow(/already reopened/);
  });
});
