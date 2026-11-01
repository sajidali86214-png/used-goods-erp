import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { dispatchPickAllocation } from "../src/modules/sales/dispatchService.js";
import { cancelReservedOrPickedQuantity } from "../src/modules/sales/cancellationService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #9: partial dispatch then cancel the remaining unshipped quantity", () => {
  it("reconciles stock state and the reservation after a partial dispatch + cancellation", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();
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

    const order = await createDraftOrder({
      orderNumber: `SO-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, quantity: 20, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 20 });
    const candidate = candidates[0]!;
    expect(candidate.quantity.toNumber()).toBe(20);

    const reservation = await reserveStock({
      orderLineId: line.id,
      costLayerId: candidate.costLayerId,
      gradeId: candidate.gradeId,
      binId: candidate.binId,
      quantity: candidate.quantity,
    });

    const pick = await pickFromReservation({
      orderLineId: line.id,
      costLayerId: candidate.costLayerId,
      gradeId: candidate.gradeId,
      binId: candidate.binId,
      quantity: 20,
      pickerUserId: user.id,
    });

    // Partial dispatch: only 12 of the 20 picked pieces actually ship.
    const { shipmentLine } = await dispatchPickAllocation({
      pickAllocationId: pick.id,
      quantity: 12,
      courier: "TestCourier",
      trackingRef: "TRACK-1",
      actorUserId: user.id,
    });
    expect(shipmentLine.quantity.toNumber()).toBe(12);

    // Cancel the remaining 8 unshipped pieces.
    const { cancellation, fromPicked, fromReservedUnpicked } = await cancelReservedOrPickedQuantity({
      reservationId: reservation.id,
      quantity: 8,
      reason: "Customer reduced order after partial shipment",
      actorUserId: user.id,
    });
    expect(cancellation.qty.toNumber()).toBe(8);
    expect(fromPicked.toNumber()).toBe(8); // all 8 were picked-but-undispatched, not merely reserved
    expect(fromReservedUnpicked.toNumber()).toBe(0);

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
    const pickingState = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: costLayer.id,
          state: "picking",
        },
      },
    });

    // 20 received -> 20 picked away -> 12 dispatched -> 8 cancelled back to saleable.
    expect(saleableState.onHandQty.toNumber()).toBe(8);
    expect(saleableState.reservedQty.toNumber()).toBe(0); // released at pick time, never re-reserved
    expect(pickingState.onHandQty.toNumber()).toBe(0); // 20 picked - 12 dispatched - 8 cancelled back

    // Invariant: a cost layer's quantityRemaining always equals the sum of
    // its on-hand across every StockState. Only the 12 dispatched pieces
    // actually left the business, so quantityRemaining should be 20 - 12 = 8,
    // matching saleable(8) + picking(0).
    const refreshedCostLayer = await prisma.costLayer.findUniqueOrThrow({
      where: { id: costLayer.id },
    });
    expect(refreshedCostLayer.quantityRemaining.toNumber()).toBe(8);

    const refreshedReservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(refreshedReservation.quantity.toNumber()).toBe(12); // exactly what shipped
    expect(refreshedReservation.status).toBe("confirmed");

    // Dispatched + cancelled reconciles exactly to the original ordered quantity.
    expect(12 + cancellation.qty.toNumber()).toBe(20);

    // A further attempt to cancel/dispatch beyond what's left must be rejected.
    await expect(
      cancelReservedOrPickedQuantity({
        reservationId: reservation.id,
        quantity: 1,
        reason: "should fail — nothing left to cancel",
        actorUserId: user.id,
      }),
    ).rejects.toThrow(/undispatched/);
  });
});
