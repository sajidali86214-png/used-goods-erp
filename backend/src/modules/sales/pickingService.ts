import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";

interface PickInput {
  orderLineId: string;
  costLayerId: string;
  gradeId: string;
  binId: string;
  quantity: Decimal | number;
  pickerUserId: string;
}

/**
 * Records the actual grade/lot composition picked for an order line.
 * - Restricted-grade lines (allowed_set / exact_composition) reject a grade
 *   outside the requirement unless amended (acceptance test #5).
 * - Mixed lines (none) accept any grade the reservations cover, and the sum
 *   across picks must not exceed the line's ordered quantity regardless of
 *   how the mix breaks down (acceptance test #4).
 * - Physically transitions the picked quantity from StockState(saleable) to
 *   StockState(picking) — this is still on-hand, just no longer available
 *   (spec section 3.4: dispatch, not picking, reduces warehouse stock).
 */
export async function pickFromReservation(input: PickInput) {
  return runSerializable(async (tx) => {
    const qty = new Decimal(input.quantity);

    const line = await tx.salesOrderLine.findUniqueOrThrow({ where: { id: input.orderLineId } });

    if (line.gradeRequirementType === "allowed_set") {
      if (!line.allowedGradeIds.includes(input.gradeId)) {
        throw new Error(
          `Grade ${input.gradeId} is not in the allowed set for this order line — amend the requirement first`,
        );
      }
    } else if (line.gradeRequirementType === "exact_composition") {
      const exact = (line.exactGradeQuantities as Record<string, number> | null) ?? {};
      const requiredForGrade = new Decimal(exact[input.gradeId] ?? 0);
      if (requiredForGrade.lessThanOrEqualTo(0)) {
        throw new Error(
          `Grade ${input.gradeId} has no required quantity in this order line's exact composition`,
        );
      }
      const alreadyPickedForGrade = sumDecimal(
        (
          await tx.pickAllocation.findMany({
            where: { orderLineId: input.orderLineId, gradeId: input.gradeId },
          })
        ).map((p) => p.pickedQty),
      );
      if (alreadyPickedForGrade.plus(qty).greaterThan(requiredForGrade)) {
        throw new Error(
          `Picking ${qty.toString()} more of grade ${input.gradeId} would exceed the required ${requiredForGrade.toString()}`,
        );
      }
    }

    // Confirmed-but-not-yet-picked reservation balance for this exact combo.
    const reservations = await tx.reservation.findMany({
      where: {
        orderLineId: input.orderLineId,
        costLayerId: input.costLayerId,
        gradeId: input.gradeId,
        binId: input.binId,
        status: { not: "released" },
      },
    });
    const reservedQty = sumDecimal(reservations.map((r) => r.quantity));
    const existingPicks = await tx.pickAllocation.findMany({
      where: {
        orderLineId: input.orderLineId,
        costLayerId: input.costLayerId,
        gradeId: input.gradeId,
        binId: input.binId,
      },
    });
    const alreadyPicked = sumDecimal(existingPicks.map((p) => p.pickedQty));
    const pickableRemaining = reservedQty.minus(alreadyPicked);

    if (qty.greaterThan(pickableRemaining)) {
      throw new Error(
        `Cannot pick ${qty.toString()} — only ${pickableRemaining.toString()} reserved and unpicked for this cost layer`,
      );
    }

    // Order-line total conservation: picks across all grades never exceed ordered quantity.
    const allLinePicks = await tx.pickAllocation.findMany({ where: { orderLineId: input.orderLineId } });
    const totalPickedSoFar = sumDecimal(allLinePicks.map((p) => p.pickedQty));
    if (totalPickedSoFar.plus(qty).greaterThan(line.quantity)) {
      throw new Error("Total picked quantity would exceed the order line's ordered quantity");
    }

    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.costLayerId },
      include: { lot: true },
    });
    const productId = costLayer.lot.productId;

    // Move physical stock saleable -> picking.
    const saleableState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "saleable",
        },
      },
    });

    const saleableOnHandAfter = saleableState.onHandQty.minus(qty);
    const saleableReservedAfter = saleableState.reservedQty.minus(qty);
    assertNonNegative(saleableOnHandAfter, "Picking would take saleable on-hand negative");
    assertNonNegative(saleableReservedAfter, "Picking would take saleable reserved negative");

    await tx.stockState.update({
      where: { id: saleableState.id },
      data: {
        onHandQty: saleableOnHandAfter,
        reservedQty: saleableReservedAfter,
        version: { increment: 1 },
      },
    });

    const pickingState = await tx.stockState.findUnique({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "picking",
        },
      },
    });

    if (pickingState) {
      await tx.stockState.update({
        where: { id: pickingState.id },
        data: { onHandQty: pickingState.onHandQty.plus(qty), version: { increment: 1 } },
      });
    } else {
      await tx.stockState.create({
        data: {
          productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "picking",
          onHandQty: qty,
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        type: "pick",
        productId,
        gradeId: input.gradeId,
        binId: input.binId,
        costLayerId: input.costLayerId,
        quantity: qty,
        relatedDocumentType: "SalesOrderLine",
        relatedDocumentId: input.orderLineId,
        actorUserId: input.pickerUserId,
      },
    });

    return tx.pickAllocation.create({
      data: {
        orderLineId: input.orderLineId,
        costLayerId: input.costLayerId,
        gradeId: input.gradeId,
        binId: input.binId,
        pickedQty: qty,
        pickerUserId: input.pickerUserId,
      },
    });
  });
}
