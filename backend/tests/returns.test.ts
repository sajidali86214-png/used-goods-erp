import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { dispatchPickAllocation } from "../src/modules/sales/dispatchService.js";
import { createReturnRequest, receiveReturnLine, inspectReturnLine } from "../src/modules/sales/returnService.js";
import { createRefund, markRefundPaid } from "../src/modules/sales/refundService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

/** Dispatches `quantity` fully-picked units of a fresh order line and returns the pick + dispatch info. */
async function dispatchFreshLine(params: {
  productId: string;
  binId: string;
  costLayerId: string;
  gradeId: string;
  channelId: string;
  customerId: string;
  currencyId: string;
  quantity: number;
  userId: string;
}) {
  const order = await createDraftOrder({
    orderNumber: `SO-${randomUUID()}`,
    channelId: params.channelId,
    customerId: params.customerId,
    currencyId: params.currencyId,
    actorUserId: params.userId,
    actorHasPriceOverride: false,
    lines: [{ productId: params.productId, quantity: params.quantity, gradeRequirementType: "none", unitPrice: 900 }],
  });
  const line = order.lines[0]!;

  await reserveStock({
    orderLineId: line.id,
    costLayerId: params.costLayerId,
    gradeId: params.gradeId,
    binId: params.binId,
    quantity: params.quantity,
  });

  const pick = await pickFromReservation({
    orderLineId: line.id,
    costLayerId: params.costLayerId,
    gradeId: params.gradeId,
    binId: params.binId,
    quantity: params.quantity,
    pickerUserId: params.userId,
  });

  await dispatchPickAllocation({
    pickAllocationId: pick.id,
    quantity: params.quantity,
    actorUserId: params.userId,
  });

  return { order, line, pick };
}

describe("acceptance test #10: regraded return with a partial refund", () => {
  it("5 returned Grade A pieces split into 3 A + 2 B, both keeping original cost; refund reconciles", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;
    const gradeB = gradeByCode.get("B")!;

    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 5,
      actorUserId: user.id,
    });

    const { order, line, pick } = await dispatchFreshLine({
      productId: product.id,
      binId: bin.id,
      costLayerId: costLayer.id,
      gradeId: gradeA.id,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      quantity: 5,
      userId: user.id,
    });

    const returnRequest = await createReturnRequest({ orderId: order.id, requestedByUserId: user.id });

    const returnLine = await receiveReturnLine({
      returnRequestId: returnRequest.id,
      orderLineId: line.id,
      costLayerId: costLayer.id,
      sourcePickAllocationId: pick.id,
      originGradeId: gradeA.id,
      quantity: 5,
      actorUserId: user.id,
    });

    const inspected = await inspectReturnLine({
      returnLineId: returnLine.id,
      outcomes: [
        { inspectedGradeId: gradeA.id, quantity: 3, disposition: "resaleable" },
        { inspectedGradeId: gradeB.id, quantity: 2, disposition: "resaleable" },
      ],
      actorUserId: user.id,
    });
    expect(inspected).toHaveLength(2);
    expect(inspected.reduce((sum, l) => sum + l.quantity.toNumber(), 0)).toBe(5);

    // Both outcomes kept the original 500 cost basis — look up where they landed.
    const gradeACostLayer = await prisma.costLayer.findFirstOrThrow({
      where: { lotId: costLayer.lotId, gradeId: gradeA.id },
    });
    const gradeBCostLayer = await prisma.costLayer.findFirstOrThrow({
      where: { lotId: costLayer.lotId, gradeId: gradeB.id },
    });
    expect(gradeACostLayer.unitCost.toNumber()).toBe(500);
    expect(gradeBCostLayer.unitCost.toNumber()).toBe(500);

    const saleableA = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: gradeACostLayer.id,
          state: "saleable",
        },
      },
    });
    const saleableB = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeB.id,
          binId: bin.id,
          costLayerId: gradeBCostLayer.id,
          state: "saleable",
        },
      },
    });
    expect(saleableA.onHandQty.toNumber()).toBe(3);
    expect(saleableB.onHandQty.toNumber()).toBe(2);

    // Partial refund: customer gets back for 2 pieces only (kept 3).
    const refund = await createRefund({ orderId: order.id, returnRequestId: returnRequest.id, amount: 1800, currencyId: currency.id });
    await markRefundPaid(refund.id, "manual-test-account");
    const refreshedRefund = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(refreshedRefund.status).toBe("refunded");
    expect(refreshedRefund.amount.toNumber()).toBe(1800);
  });
});

describe("acceptance test #11: origin-uncertain return from a multi-lot order", () => {
  it("requires an explicit documented assumption and blocks excess returns", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    const lot1Layer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 5,
      actorUserId: user.id,
    });
    const lot2Layer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 600,
      quantity: 5,
      actorUserId: user.id,
    });

    // One order line fulfilled from two lots (multi-lot dispatch).
    const order = await createDraftOrder({
      orderNumber: `SO-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 10, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    for (const layer of [lot1Layer, lot2Layer]) {
      await reserveStock({ orderLineId: line.id, costLayerId: layer.id, gradeId: gradeA.id, binId: bin.id, quantity: 5 });
      const pick = await pickFromReservation({
        orderLineId: line.id,
        costLayerId: layer.id,
        gradeId: gradeA.id,
        binId: bin.id,
        quantity: 5,
        pickerUserId: user.id,
      });
      await dispatchPickAllocation({ pickAllocationId: pick.id, quantity: 5, actorUserId: user.id });
    }

    const returnRequest = await createReturnRequest({ orderId: order.id, requestedByUserId: user.id });

    // Customer returns 4 pieces; staff can't tell from which lot. Must be rejected without an explicit assumption.
    await expect(
      receiveReturnLine({
        returnRequestId: returnRequest.id,
        orderLineId: line.id,
        costLayerId: lot1Layer.id,
        originGradeId: gradeA.id,
        quantity: 4,
        actorUserId: user.id,
        // no sourcePickAllocationId, no originUncertain/assumptionNotes
      }),
    ).rejects.toThrow(/originUncertain/);

    // With an explicit, documented assumption (approved allocation to lot 1), it's allowed.
    const returnLine = await receiveReturnLine({
      returnRequestId: returnRequest.id,
      orderLineId: line.id,
      costLayerId: lot1Layer.id,
      originGradeId: gradeA.id,
      quantity: 4,
      originUncertain: true,
      assumptionNotes: "Multi-lot dispatch, exact origin unknown — approved assumption: allocate to lot 1 (FIFO)",
      actorUserId: user.id,
    });
    expect(returnLine.originUncertain).toBe(true);
    expect(returnLine.assumptionNotes).toMatch(/approved assumption/);

    // Excess return beyond what was dispatched (10) must be rejected: only 6 left returnable.
    await expect(
      receiveReturnLine({
        returnRequestId: returnRequest.id,
        orderLineId: line.id,
        costLayerId: lot2Layer.id,
        originGradeId: gradeA.id,
        quantity: 7,
        originUncertain: true,
        assumptionNotes: "attempted excess return",
        actorUserId: user.id,
      }),
    ).rejects.toThrow(/returnable/);
  });
});
