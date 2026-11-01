import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";

export interface AllocationCandidate {
  costLayerId: string;
  gradeId: string;
  binId: string;
  quantity: Decimal;
}

/**
 * Suggests a FIFO (oldest-lot-first) allocation of `quantity` units of
 * `productId` from saleable stock, optionally restricted to `allowedGradeIds`.
 * This is a suggestion only — spec section 7.3: the actual mix stays
 * provisional until picking confirms it. Returns less than `quantity` worth
 * of candidates if stock is insufficient (partial availability, not an error).
 */
export async function suggestAllocation(params: {
  productId: string;
  quantity: Decimal | number;
  allowedGradeIds?: string[];
}): Promise<{ candidates: AllocationCandidate[]; fulfilledQty: Decimal }> {
  const target = new Decimal(params.quantity);

  const saleableStates = await prisma.stockState.findMany({
    where: {
      productId: params.productId,
      state: "saleable",
      ...(params.allowedGradeIds ? { gradeId: { in: params.allowedGradeIds } } : {}),
    },
    include: { costLayer: true },
    orderBy: { costLayer: { createdAt: "asc" } },
  });

  const candidates: AllocationCandidate[] = [];
  let remaining = target;

  for (const state of saleableStates) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const available = state.onHandQty.minus(state.reservedQty);
    if (available.lessThanOrEqualTo(0)) continue;

    const take = Decimal.min(available, remaining);
    candidates.push({
      costLayerId: state.costLayerId,
      gradeId: state.gradeId,
      binId: state.binId,
      quantity: take,
    });
    remaining = remaining.minus(take);
  }

  return { candidates, fulfilledQty: target.minus(remaining) };
}

interface ReserveInput {
  orderLineId: string;
  costLayerId: string;
  gradeId: string;
  binId: string;
  quantity: Decimal | number;
}

/**
 * Reserves `quantity` units against a specific saleable StockState row.
 * Runs in a SERIALIZABLE transaction so two concurrent reservations against
 * the same row can never both succeed if together they exceed availability
 * (acceptance test #7) — one commits, the other gets a serialization
 * failure from `runSerializable` and is told there wasn't enough stock.
 */
export async function reserveStock(input: ReserveInput) {
  return runSerializable(async (tx) => {
    const qty = new Decimal(input.quantity);

    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.costLayerId },
      include: { lot: true },
    });

    const state = await tx.stockState.findUnique({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: costLayer.lot.productId,
          gradeId: input.gradeId,
          binId: input.binId,
          costLayerId: input.costLayerId,
          state: "saleable",
        },
      },
    });

    if (!state) {
      throw new Error("No saleable stock state for this product/grade/bin/cost layer");
    }

    const available = state.onHandQty.minus(state.reservedQty);
    if (available.lessThan(qty)) {
      throw new Error(
        `Insufficient available stock: requested ${qty.toString()}, available ${available.toString()}`,
      );
    }

    await tx.stockState.update({
      where: { id: state.id },
      data: { reservedQty: state.reservedQty.plus(qty), version: { increment: 1 } },
    });

    const reservation = await tx.reservation.create({
      data: {
        orderLineId: input.orderLineId,
        costLayerId: input.costLayerId,
        gradeId: input.gradeId,
        binId: input.binId,
        quantity: qty,
        status: "confirmed",
      },
    });

    return reservation;
  });
}

/** Releases a reservation (cancellation, or reallocation during picking) back to availability. */
export async function releaseReservation(reservationId: string) {
  return runSerializable(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status === "released") {
      return reservation;
    }

    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: reservation.costLayerId },
      include: { lot: true },
    });

    const state = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: costLayer.lot.productId,
          gradeId: reservation.gradeId,
          binId: reservation.binId,
          costLayerId: reservation.costLayerId,
          state: "saleable",
        },
      },
    });

    const newReserved = state.reservedQty.minus(reservation.quantity);
    assertNonNegative(newReserved, "Releasing this reservation would make reservedQty negative");

    await tx.stockState.update({
      where: { id: state.id },
      data: { reservedQty: newReserved, version: { increment: 1 } },
    });

    return tx.reservation.update({ where: { id: reservationId }, data: { status: "released" } });
  });
}

/** Sum of active (non-released) reservation quantity for an order line. */
export async function totalReservedForLine(orderLineId: string): Promise<Decimal> {
  const reservations = await prisma.reservation.findMany({
    where: { orderLineId, status: { not: "released" } },
  });
  return sumDecimal(reservations.map((r) => r.quantity));
}
