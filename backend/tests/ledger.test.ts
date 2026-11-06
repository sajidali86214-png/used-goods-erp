import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { dispatchPickAllocation } from "../src/modules/sales/dispatchService.js";
import {
  postExpense,
  postSupplierAdvance,
  postCustomerReceipt,
  postSaleDispatch,
  postRefund,
  postTransfer,
  postOwnerTransaction,
  getAccountBalance,
} from "../src/modules/finance/ledgerService.js";
import { createRefund, markRefundPaid } from "../src/modules/sales/refundService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

async function pkrAccount(label: string, nature = "asset") {
  return prisma.account.create({
    data: { label, currencyId: (await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } })).id, kind: "bank", nature },
  });
}

describe("finance ledger: every posting is balanced and account balances reflect it", () => {
  it("posts an expense as a balanced entry and updates both account balances", async () => {
    const bank = await pkrAccount(`Bank-${randomUUID()}`);
    const category = await prisma.expenseCategory.create({ data: { label: "Rent" } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

    const expense = await prisma.expense.create({
      data: {
        date: new Date(),
        payeeType: "other",
        categoryId: category.id,
        currencyId: pkr.id,
        amount: 15000,
        paymentStatus: "paid",
        accountId: bank.id,
      },
    });

    const bankBalanceBefore = await getAccountBalance(bank.id);
    await postExpense(expense.id);
    const bankBalanceAfter = await getAccountBalance(bank.id);

    expect(bankBalanceAfter.toNumber()).toBe(bankBalanceBefore.toNumber() - 15000);

    const opex = await prisma.account.findUniqueOrThrow({ where: { code: "OPERATING_EXPENSES" } });
    const opexEntries = await prisma.ledgerEntry.findMany({
      where: { relatedDocumentType: "Expense", relatedDocumentId: expense.id },
    });
    expect(opexEntries).toHaveLength(2);
    expect(opexEntries.find((e) => e.accountId === opex.id)?.direction).toBe("debit");
  });

  it("posts a supplier advance, a customer receipt, and a paid refund correctly", async () => {
    const bank = await pkrAccount(`Bank-${randomUUID()}`);
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

    const supplier = await prisma.supplier.create({ data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: pkr.id } });
    const advance = await prisma.supplierAdvance.create({
      data: {
        supplierId: supplier.id,
        currencyId: pkr.id,
        amount: 5000,
        paidAt: new Date(),
        paymentMethodAccountId: bank.id,
      },
    });
    const balanceBeforeAdvance = await getAccountBalance(bank.id);
    await postSupplierAdvance(advance.id);
    expect((await getAccountBalance(bank.id)).toNumber()).toBe(balanceBeforeAdvance.toNumber() - 5000);
    const supplierAdvancesAccount = await prisma.account.findUniqueOrThrow({ where: { code: "SUPPLIER_ADVANCES" } });
    expect((await getAccountBalance(supplierAdvancesAccount.id)).toNumber()).toBeGreaterThanOrEqual(5000);

    const customer = await prisma.customer.create({ data: { name: `Customer-${randomUUID()}` } });
    const channel = await prisma.salesChannel.upsert({
      where: { code: "local_market" },
      update: {},
      create: { code: "local_market", label: "Local market" },
    });
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const product = await prisma.product.create({ data: { skuCode: `SKU-${randomUUID()}`, name: "P", categoryId: category.id } });
    const ledgerTestUser = await prisma.user.create({
      data: { name: "Ledger Test User", email: `ledger-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: pkr.id,
      actorUserId: ledgerTestUser.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 1000 }],
    });

    const receipt = await prisma.paymentReceipt.create({
      data: {
        customerId: customer.id,
        currencyId: pkr.id,
        amount: 1000,
        receivedAt: new Date(),
        destinationAccountId: bank.id,
        exchangeRateSnapshotId: (
          await prisma.exchangeRateSnapshot.create({
            data: { fromCurrencyId: pkr.id, toCurrencyId: pkr.id, rate: 1, source: "test" },
          })
        ).id,
        allocations: { create: [{ orderId: order.id, amount: 1000 }] },
      },
    });
    const balanceBeforeReceipt = await getAccountBalance(bank.id);
    await postCustomerReceipt(receipt.id);
    expect((await getAccountBalance(bank.id)).toNumber()).toBe(balanceBeforeReceipt.toNumber() + 1000);

    const refund = await createRefund({ orderId: order.id, amount: 200, currencyId: pkr.id });
    await markRefundPaid(refund.id, bank.id);
    const balanceBeforeRefund = await getAccountBalance(bank.id);
    await postRefund(refund.id);
    expect((await getAccountBalance(bank.id)).toNumber()).toBe(balanceBeforeRefund.toNumber() - 200);
  });

  it("posts revenue/COGS at dispatch matching the same worked example as profitabilityService (45000/28000/17000)", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 500, quantity: 20, actorUserId: user.id });
    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 600, quantity: 30, actorUserId: user.id });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 50, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 50 });
    const pickIds: string[] = [];
    for (const candidate of candidates) {
      await reserveStock({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity });
      const pick = await pickFromReservation({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity, pickerUserId: user.id });
      pickIds.push(pick.id);
    }

    const salesRevenue = await prisma.account.findUniqueOrThrow({ where: { code: "SALES_REVENUE" } });
    const cogsAccount = await prisma.account.findUniqueOrThrow({ where: { code: "COGS" } });
    const revenueBefore = await getAccountBalance(salesRevenue.id);
    const cogsBefore = await getAccountBalance(cogsAccount.id);

    for (const pickId of pickIds) {
      const pick = await prisma.pickAllocation.findUniqueOrThrow({ where: { id: pickId } });
      const { shipmentLine } = await dispatchPickAllocation({ pickAllocationId: pickId, quantity: pick.pickedQty.toNumber(), actorUserId: user.id });
      await postSaleDispatch(shipmentLine.id);
    }

    const revenueAfter = await getAccountBalance(salesRevenue.id);
    const cogsAfter = await getAccountBalance(cogsAccount.id);

    expect(revenueAfter.minus(revenueBefore).toNumber()).toBe(45000);
    expect(cogsAfter.minus(cogsBefore).toNumber()).toBe(28000);
  });

  it("rejects posting a non-PKR amount rather than guessing an FX treatment", async () => {
    const gbp = await prisma.currency.upsert({ where: { code: "GBP" }, update: {}, create: { code: "GBP", symbol: "Â£" } });
    const bank = await prisma.account.create({ data: { label: `GBP-${randomUUID()}`, currencyId: gbp.id, kind: "bank" } });
    const category = await prisma.expenseCategory.create({ data: { label: "Foreign expense" } });

    const expense = await prisma.expense.create({
      data: { date: new Date(), payeeType: "other", categoryId: category.id, currencyId: gbp.id, amount: 100, paymentStatus: "paid", accountId: bank.id },
    });

    await expect(postExpense(expense.id)).rejects.toThrow(/accountant-approved FX/);
  });

  it("posts transfers and owner transactions as balanced entries excluded from P&L accounts", async () => {
    const bankA = await pkrAccount(`Bank-${randomUUID()}`);
    const bankB = await pkrAccount(`Bank-${randomUUID()}`);
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

    const transfer = await prisma.transfer.create({
      data: { fromAccountId: bankA.id, toAccountId: bankB.id, amount: 2000, currencyId: pkr.id },
    });
    const aBefore = await getAccountBalance(bankA.id);
    const bBefore = await getAccountBalance(bankB.id);
    await postTransfer(transfer.id);
    expect((await getAccountBalance(bankA.id)).toNumber()).toBe(aBefore.toNumber() - 2000);
    expect((await getAccountBalance(bankB.id)).toNumber()).toBe(bBefore.toNumber() + 2000);

    const ownersEquity = await prisma.account.findUniqueOrThrow({ where: { code: "OWNERS_EQUITY" } });
    const equityBefore = await getAccountBalance(ownersEquity.id);
    const contribution = await prisma.ownerTransaction.create({
      data: { accountId: bankA.id, amount: 10000, type: "contribution" },
    });
    const bankABefore = await getAccountBalance(bankA.id);
    await postOwnerTransaction(contribution.id);
    expect((await getAccountBalance(bankA.id)).toNumber()).toBe(bankABefore.toNumber() + 10000);
    expect((await getAccountBalance(ownersEquity.id)).toNumber()).toBe(equityBefore.toNumber() + 10000);

    const salesRevenue = await prisma.account.findUniqueOrThrow({ where: { code: "SALES_REVENUE" } });
    const revenueEntriesForTransfer = await prisma.ledgerEntry.findMany({
      where: { accountId: salesRevenue.id, relatedDocumentType: { in: ["Transfer", "OwnerTransaction"] } },
    });
    expect(revenueEntriesForTransfer).toHaveLength(0);
  });
});
