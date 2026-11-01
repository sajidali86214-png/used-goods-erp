import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DB-level CHECK constraints: a second line of defense behind the service-layer checks", () => {
  it("rejects a raw update that would make reservedQty exceed onHandQty", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 5,
      actorUserId: user.id,
    });

    const state = await prisma.stockState.findFirstOrThrow({
      where: { costLayerId: costLayer.id, state: "saleable" },
    });

    // Bypassing the service layer entirely — simulates a future bug, not normal usage.
    await expect(
      prisma.stockState.update({ where: { id: state.id }, data: { reservedQty: 999 } }),
    ).rejects.toThrow();
  });

  it("rejects a raw negative quantityRemaining on a cost layer", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeByCode.get("A")!.id,
      unitPrice: 500,
      quantity: 5,
      actorUserId: user.id,
    });

    await expect(
      prisma.costLayer.update({ where: { id: costLayer.id }, data: { quantityRemaining: -1 } }),
    ).rejects.toThrow();
  });
});
