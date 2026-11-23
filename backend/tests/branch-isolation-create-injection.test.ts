import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, rawPrisma } from "../src/lib/prisma.js";
import { TEST_MAIN_BRANCH_ID } from "./setup.js";

afterAll(async () => {
  await rawPrisma.$disconnect();
});

describe("branch scope extension: create-side auto-injection", () => {
  it("stamps the current branch onto a row even though the caller never passed branchId", async () => {
    const supplier = await prisma.supplier.create({
      data: { name: `Create-Injection-Supplier-${randomUUID()}`, defaultCurrencyId: (await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } })).id },
    });

    const stored = await rawPrisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
    expect(stored.branchId).toBe(TEST_MAIN_BRANCH_ID);
  });

  it("throws rather than silently overriding when a caller explicitly names a different branch", async () => {
    const otherBranch = await rawPrisma.branch.create({
      data: { name: `Other-${randomUUID()}`, code: `OTH-${randomUUID().slice(0, 8)}` },
    });

    await expect(
      prisma.bin.findMany({ where: { branchId: otherBranch.id } }),
    ).rejects.toThrow(/branch scope conflict/);
  });
});
