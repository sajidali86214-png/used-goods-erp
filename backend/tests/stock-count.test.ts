import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createStockCount, submitStockCount, approveStockCountVariance } from "../src/modules/stock/stockCountService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #18: physical count variance requires approval and preserves the ledger", () => {
  it("posts no adjustment until approved, then adjusts and keeps prior movement history", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 20,
      actorUserId: user.id,
    });

    const movementsBefore = await prisma.stockMovement.count({ where: { costLayerId: costLayer.id } });

    // Physical count finds only 17 on the shelf — a shortage of 3.
    const count = await createStockCount({
      countDate: new Date(),
      binId: bin.id,
      lines: [
        { productId: product.id, gradeId: gradeA.id, binId: bin.id, costLayerId: costLayer.id, countedQty: 17 },
      ],
    });
    expect(count.lines[0]!.systemQty.toNumber()).toBe(20);
    expect(count.lines[0]!.varianceQty.toNumber()).toBe(-3);

    // Not yet approved — stock must be untouched.
    const beforeApproval = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: costLayer.id,
          state: "saleable",
        },
      },
    });
    expect(beforeApproval.onHandQty.toNumber()).toBe(20);

    // Approving before submitting must be rejected.
    await expect(
      approveStockCountVariance({ stockCountId: count.id, approvedByUserId: user.id, binId: bin.id }),
    ).rejects.toThrow(/submitted/);

    await submitStockCount(count.id);
    const approved = await approveStockCountVariance({
      stockCountId: count.id,
      approvedByUserId: user.id,
      binId: bin.id,
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByUserId).toBe(user.id);

    const afterApproval = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: costLayer.id,
          state: "saleable",
        },
      },
    });
    expect(afterApproval.onHandQty.toNumber()).toBe(17);

    const refreshedCostLayer = await prisma.costLayer.findUniqueOrThrow({ where: { id: costLayer.id } });
    expect(refreshedCostLayer.quantityRemaining.toNumber()).toBe(17);

    // The original receive movement is still there, plus one new adjustment — nothing was overwritten.
    const movementsAfter = await prisma.stockMovement.findMany({ where: { costLayerId: costLayer.id } });
    expect(movementsAfter).toHaveLength(movementsBefore + 1);
    const adjustment = movementsAfter.find((m) => m.type === "count_adjustment");
    expect(adjustment?.quantity.toNumber()).toBe(3);
    // The grading-transfer movement that created this cost layer is still there, untouched.
    expect(movementsAfter.some((m) => m.type === "grading_transfer")).toBe(true);
  });
});
