import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";

interface DispatchInput {
  pickAllocationId: string;
  quantity: Decimal | number;
  shipmentId?: string;
  courier?: string;
  trackingRef?: string;
  actorUserId: string;
}

/**
 * Dispatch is what actually reduces warehouse stock (spec section 3.4) —
 * picking only moved it from saleable to the non-available "picking" state.
 * Partial dispatch is tracked per PickAllocation so "remaining to dispatch"
 * stays correct across multiple shipments (acceptance test #9).
 */
export async function dispatchPickAllocation(input: DispatchInput) {
  return runSerializable(async (tx) => {
    const qty = new Decimal(input.quantity);

    const pick = await tx.pickAllocation.findUniqueOrThrow({
      where: { id: input.pickAllocationId },
      include: { costLayer: { include: { lot: true } }, orderLine: true },
    });

    const existingShipmentLines = await tx.shipmentLine.findMany({
      where: { pickAllocationId: input.pickAllocationId },
    });
    const alreadyDispatched = sumDecimal(existingShipmentLines.map((l) => l.quantity));
    const remaining = pick.pickedQty.minus(alreadyDispatched);

    if (qty.greaterThan(remaining)) {
      throw new Error(
        `Cannot dispatch ${qty.toString()} — only ${remaining.toString()} of this pick is undispatched`,
      );
    }

    const productId = pick.costLayer.lot.productId;

    const pickingState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: pick.gradeId,
          binId: pick.binId,
          costLayerId: pick.costLayerId,
          state: "picking",
        },
      },
    });
    const pickingOnHandAfter = pickingState.onHandQty.minus(qty);
    assertNonNegative(pickingOnHandAfter, "Dispatch would take picking-state on-hand negative");

    await tx.stockState.update({
      where: { id: pickingState.id },
      data: { onHandQty: pickingOnHandAfter, version: { increment: 1 } },
    });

    // Dispatch permanently removes stock from the business — unlike a pure
    // state transfer (reserve/pick/cancel-before-dispatch), nothing on the
    // other side increases, so the cost layer's remaining quantity (which
    // equals the sum of its on-hand across all states) must drop too.
    const costLayerAfter = pick.costLayer.quantityRemaining.minus(qty);
    assertNonNegative(costLayerAfter, "Dispatch would take cost layer quantityRemaining negative");
    await tx.costLayer.update({
      where: { id: pick.costLayerId },
      data: { quantityRemaining: costLayerAfter },
    });

    await tx.stockMovement.create({
      data: {
        type: "dispatch",
        productId,
        gradeId: pick.gradeId,
        binId: pick.binId,
        costLayerId: pick.costLayerId,
        quantity: qty,
        relatedDocumentType: "PickAllocation",
        relatedDocumentId: pick.id,
        actorUserId: input.actorUserId,
      },
    });

    const shipment = input.shipmentId
      ? await tx.shipment.findUniqueOrThrow({ where: { id: input.shipmentId } })
      : await tx.shipment.create({
          data: {
            orderId: pick.orderLine.orderId,
            courier: input.courier,
            trackingRef: input.trackingRef,
            status: "dispatched",
            dispatchedAt: new Date(),
          },
        });

    const shipmentLine = await tx.shipmentLine.create({
      data: {
        shipmentId: shipment.id,
        orderLineId: pick.orderLineId,
        pickAllocationId: pick.id,
        quantity: qty,
      },
    });

    return { shipment, shipmentLine };
  });
}

/** Total dispatched quantity for an order line, across all shipments. */
export async function totalDispatchedForLine(orderLineId: string): Promise<Decimal> {
  const lines = await prisma.shipmentLine.findMany({ where: { orderLineId } });
  return sumDecimal(lines.map((l) => l.quantity));
}

/** Total dispatched quantity against one specific pick allocation. */
export async function totalDispatchedForPick(pickAllocationId: string): Promise<Decimal> {
  const lines = await prisma.shipmentLine.findMany({ where: { pickAllocationId } });
  return sumDecimal(lines.map((l) => l.quantity));
}
