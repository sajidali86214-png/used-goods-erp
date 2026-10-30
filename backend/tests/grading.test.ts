import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { receiveToInspection, gradeTransfer, writeOff } from "../src/modules/stock/stockService.js";
import { seedReferenceData } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #1: grading conserves quantity and cost", () => {
  it("splitting 100 pieces into 30/40/30 keeps total quantity and value unchanged", async () => {
    const { currency, bin, product, gradeByCode, user } = await seedReferenceData();

    const { costLayer } = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 500,
      exchangeRate: 1,
      quantity: 100,
      binId: bin.id,
      lotCode: `LOT-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });

    expect(costLayer.unitCost.toNumber()).toBe(500);

    const { source, created } = await gradeTransfer({
      sourceCostLayerId: costLayer.id,
      splits: [
        { gradeId: gradeByCode.get("A")!.id, binId: bin.id, quantity: 30 },
        { gradeId: gradeByCode.get("B")!.id, binId: bin.id, quantity: 40 },
        { gradeId: gradeByCode.get("C")!.id, binId: bin.id, quantity: 30 },
      ],
      actorUserId: user.id,
    });

    expect(source.quantityRemaining.toNumber()).toBe(0);

    const totalQty = created.reduce((sum, l) => sum + l.quantityRemaining.toNumber(), 0);
    expect(totalQty).toBe(100);

    // cost is unchanged by grading — every new layer still carries unitCost 500
    for (const layer of created) {
      expect(layer.unitCost.toNumber()).toBe(500);
    }

    const totalValue = created.reduce(
      (sum, l) => sum + l.quantityRemaining.toNumber() * l.unitCost.toNumber(),
      0,
    );
    expect(totalValue).toBe(100 * 500);
  });

  it("rejects a grading transfer whose splits do not sum to the remaining quantity", async () => {
    const { currency, bin, product, gradeByCode, user } = await seedReferenceData();

    const { costLayer } = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 500,
      exchangeRate: 1,
      quantity: 100,
      binId: bin.id,
      lotCode: `LOT-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });

    await expect(
      gradeTransfer({
        sourceCostLayerId: costLayer.id,
        splits: [
          { gradeId: gradeByCode.get("A")!.id, binId: bin.id, quantity: 30 },
          { gradeId: gradeByCode.get("B")!.id, binId: bin.id, quantity: 40 },
          // missing 30 — should fail, not silently drop quantity
        ],
        actorUserId: user.id,
      }),
    ).rejects.toThrow(/conserve/);
  });
});

describe("acceptance test #2: separately purchased cheaper Grade C keeps its own cost", () => {
  it("does not overwrite or blend with existing Grade C cost", async () => {
    const { currency, bin, product, gradeByCode, user } = await seedReferenceData();

    // Lot 1: 50 pieces at 500, graded into some C
    const lot1 = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 500,
      exchangeRate: 1,
      quantity: 50,
      binId: bin.id,
      lotCode: `LOT-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });
    const { created: lot1Created } = await gradeTransfer({
      sourceCostLayerId: lot1.costLayer.id,
      splits: [{ gradeId: gradeByCode.get("C")!.id, binId: bin.id, quantity: 50 }],
      actorUserId: user.id,
    });
    const lot1GradeC = lot1Created[0]!;
    expect(lot1GradeC.unitCost.toNumber()).toBe(500);

    // Lot 2: separately purchased, already known to be Grade C, at a lower price
    const lot2 = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 200,
      exchangeRate: 1,
      quantity: 20,
      binId: bin.id,
      lotCode: `LOT-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });
    const { created: lot2Created } = await gradeTransfer({
      sourceCostLayerId: lot2.costLayer.id,
      splits: [{ gradeId: gradeByCode.get("C")!.id, binId: bin.id, quantity: 20 }],
      actorUserId: user.id,
    });
    const lot2GradeC = lot2Created[0]!;
    expect(lot2GradeC.unitCost.toNumber()).toBe(200);

    // The two Grade C cost layers remain distinct — neither overwrote the other
    expect(lot1GradeC.id).not.toBe(lot2GradeC.id);

    const allGradeCLayers = await prisma.costLayer.findMany({
      where: { lot: { productId: product.id }, gradeId: gradeByCode.get("C")!.id },
    });
    const costs = allGradeCLayers.map((l) => l.unitCost.toNumber()).sort();
    expect(costs).toEqual([200, 500]);
  });
});

describe("no negative stock", () => {
  it("rejects a write-off larger than the remaining quantity", async () => {
    const { currency, bin, product, user } = await seedReferenceData();

    const { costLayer } = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 500,
      exchangeRate: 1,
      quantity: 10,
      binId: bin.id,
      lotCode: `LOT-${crypto.randomUUID()}`,
      actorUserId: user.id,
    });

    await expect(
      writeOff({
        costLayerId: costLayer.id,
        state: "inspection",
        quantity: 11,
        reason: "test over-writeoff",
        actorUserId: user.id,
      }),
    ).rejects.toThrow(/negative/);
  });
});
