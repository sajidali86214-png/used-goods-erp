import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { separateForIndividualSale, returnIndividualItemToBulk } from "../src/modules/stock/individualItemService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #8: separate one piece for individual sale, then return it to bulk", () => {
  it("keeps total physical stock and cost unchanged throughout", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 10,
      actorUserId: user.id,
    });

    const photo = await prisma.mediaAsset.create({
      data: {
        kind: "individual_item",
        storageKey: `test/${randomUUID()}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        uploadedByUserId: user.id,
        uploadStatus: "complete",
      },
    });

    const totalPhysical = async () => {
      const states = await prisma.stockState.findMany({ where: { costLayerId: costLayer.id } });
      return states.reduce((sum, s) => sum + s.onHandQty.toNumber(), 0);
    };

    expect(await totalPhysical()).toBe(10);

    const item = await separateForIndividualSale({
      costLayerId: costLayer.id,
      gradeId: gradeA.id,
      binId: bin.id,
      photoMediaAssetIds: [photo.id],
      actorUserId: user.id,
    });
    expect(item.status).toBe("listed");

    // Still 10 pieces total, just one of them now tracked individually.
    expect(await totalPhysical()).toBe(10);
    const refreshedCostLayer = await prisma.costLayer.findUniqueOrThrow({ where: { id: costLayer.id } });
    expect(refreshedCostLayer.quantityRemaining.toNumber()).toBe(10); // unchanged — no inventory created or destroyed

    const saleableState = await prisma.stockState.findUniqueOrThrow({
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
    expect(saleableState.onHandQty.toNumber()).toBe(9);

    const individualState = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: costLayer.id,
          state: "individual",
        },
      },
    });
    expect(individualState.onHandQty.toNumber()).toBe(1);

    // Unsold — return it to the bulk pool.
    const returned = await returnIndividualItemToBulk({
      individualItemId: item.id,
      binId: bin.id,
      actorUserId: user.id,
    });
    expect(returned.status).toBe("returned_to_bulk");

    expect(await totalPhysical()).toBe(10);
    const finalCostLayer = await prisma.costLayer.findUniqueOrThrow({ where: { id: costLayer.id } });
    expect(finalCostLayer.quantityRemaining.toNumber()).toBe(10);
    expect(finalCostLayer.unitCost.toNumber()).toBe(500); // cost never touched by this cycle

    const finalSaleable = await prisma.stockState.findUniqueOrThrow({
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
    expect(finalSaleable.onHandQty.toNumber()).toBe(10); // back to the full bulk pool

    // A second return attempt must be rejected — already returned.
    await expect(
      returnIndividualItemToBulk({ individualItemId: item.id, binId: bin.id, actorUserId: user.id }),
    ).rejects.toThrow(/returned_to_bulk/);
  });

  it("requires at least one photo", async () => {
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

    await expect(
      separateForIndividualSale({
        costLayerId: costLayer.id,
        gradeId: gradeA.id,
        binId: bin.id,
        photoMediaAssetIds: [],
        actorUserId: user.id,
      }),
    ).rejects.toThrow(/photo/);
  });
});
