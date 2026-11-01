import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { totalDispatchedForPick } from "./dispatchService.js";

interface CancelInput {
  reservationId: string;
  quantity: Decimal | number;
  reason: string;
  actorUserId: string;
  feeChargedAmount?: Decimal | number;
  feeBeneficiary?: string;
  refundDueAmount?: Decimal | number;
  approvedByUserId?: string;
}

/**
 * Cancels up to `quantity` units of a reservation that have not yet been
 * dispatched (spec section 8: "Cancellation before dispatch releases
 * affected reservations. Cancellation after dispatch does not restore
 * warehouse inventory"). Splits the cancelled amount across whichever part
 * is still only reserved (never picked) and whichever part was picked but
 * not yet dispatched — acceptance test #9.
 */
export async function cancelReservedOrPickedQuantity(input: CancelInput) {
  return runSerializable(async (tx) => {
    const qty = new Decimal(input.quantity);

    const reservation = await tx.reservation.findUniqueOrThrow({
      where: { id: input.reservationId },
    });
    if (reservation.status === "released") {
      throw new Error("Reservation is already released");
    }

    const matchingPicks = await tx.pickAllocation.findMany({
      where: {
        orderLineId: reservation.orderLineId,
        costLayerId: reservation.costLayerId,
        gradeId: reservation.gradeId,
        binId: reservation.binId,
      },
    });
    const pickedAgainstReservation = sumDecimal(matchingPicks.map((p) => p.pickedQty));

    const dispatchedAmounts = await Promise.all(
      matchingPicks.map((p) => totalDispatchedForPick(p.id)),
    );
    const dispatchedAgainstReservation = sumDecimal(dispatchedAmounts);

    const cancellable = reservation.quantity.minus(dispatchedAgainstReservation);
    if (qty.greaterThan(cancellable)) {
      throw new Error(
        `Cannot cancel ${qty.toString()} — only ${cancellable.toString()} of this reservation is undispatched`,
      );
    }

    const pickedUndispatched = pickedAgainstReservation.minus(dispatchedAgainstReservation);
    const fromPicked = Decimal.min(qty, pickedUndispatched);
    const fromReservedUnpicked = qty.minus(fromPicked);

    const productId = (
      await tx.costLayer.findUniqueOrThrow({
        where: { id: reservation.costLayerId },
        include: { lot: true },
      })
    ).lot.productId;

    const saleableState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: reservation.gradeId,
          binId: reservation.binId,
          costLayerId: reservation.costLayerId,
          state: "saleable",
        },
      },
    });

    if (fromPicked.greaterThan(0)) {
      // Reverse the pick: move on-hand back from picking -> saleable. The
      // reservation's hold on saleable.reservedQty was already released at
      // pick time, so it stays as-is — this quantity becomes available again.
      const pickingState = await tx.stockState.findUniqueOrThrow({
        where: {
          productId_gradeId_binId_costLayerId_state: {
            productId,
            gradeId: reservation.gradeId,
            binId: reservation.binId,
            costLayerId: reservation.costLayerId,
            state: "picking",
          },
        },
      });
      const pickingOnHandAfter = pickingState.onHandQty.minus(fromPicked);
      assertNonNegative(pickingOnHandAfter, "Cancellation would take picking-state on-hand negative");

      await tx.stockState.update({
        where: { id: pickingState.id },
        data: { onHandQty: pickingOnHandAfter, version: { increment: 1 } },
      });
      await tx.stockState.update({
        where: { id: saleableState.id },
        data: { onHandQty: saleableState.onHandQty.plus(fromPicked), version: { increment: 1 } },
      });
      await tx.stockMovement.create({
        data: {
          type: "release",
          productId,
          gradeId: reservation.gradeId,
          binId: reservation.binId,
          costLayerId: reservation.costLayerId,
          quantity: fromPicked,
          relatedDocumentType: "Reservation",
          relatedDocumentId: reservation.id,
          actorUserId: input.actorUserId,
        },
      });
    }

    if (fromReservedUnpicked.greaterThan(0)) {
      const reservedAfter = saleableState.reservedQty.minus(fromReservedUnpicked);
      assertNonNegative(reservedAfter, "Cancellation would take reservedQty negative");
      await tx.stockState.update({
        where: { id: saleableState.id },
        data: { reservedQty: reservedAfter, version: { increment: 1 } },
      });
      await tx.stockMovement.create({
        data: {
          type: "release",
          productId,
          gradeId: reservation.gradeId,
          binId: reservation.binId,
          costLayerId: reservation.costLayerId,
          quantity: fromReservedUnpicked,
          relatedDocumentType: "Reservation",
          relatedDocumentId: reservation.id,
          actorUserId: input.actorUserId,
        },
      });
    }

    const remainingReservationQty = reservation.quantity.minus(qty);
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        quantity: remainingReservationQty,
        status: remainingReservationQty.isZero() ? "released" : reservation.status,
      },
    });

    const cancellation = await tx.cancellation.create({
      data: {
        orderLineId: reservation.orderLineId,
        qty,
        reason: input.reason,
        feeChargedAmount:
          input.feeChargedAmount !== undefined ? new Decimal(input.feeChargedAmount) : undefined,
        feeBeneficiary: input.feeBeneficiary,
        refundDueAmount:
          input.refundDueAmount !== undefined ? new Decimal(input.refundDueAmount) : undefined,
        approvedByUserId: input.approvedByUserId,
      },
    });

    return { cancellation, fromPicked, fromReservedUnpicked };
  });
}
