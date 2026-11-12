import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { suggestAllocation, reserveStock } from "./reservationService.js";
import { pickFromReservation } from "./pickingService.js";
import { dispatchPickAllocation } from "./dispatchService.js";
import { postSaleDispatch } from "../finance/ledgerService.js";

/**
 * The admin UI's day-to-day workflow is the simple QC/payment/fulfilment
 * status dropdowns, not the detailed reserve -> pick -> dispatch screens —
 * which meant revenue/COGS were never actually recognized for a real sale:
 * nothing ever called the real pipeline, so SALES_REVENUE/COGS stayed at
 * zero regardless of how many orders were marked "dispatched".
 *
 * This runs the real pipeline automatically, behind the simple dropdown,
 * whenever fulfilmentStatus is set to "dispatched" or "delivered": for each
 * mixed-grade ("none" requirement) line, it FIFO-allocates, reserves,
 * picks, and dispatches whatever's still outstanding, then posts each
 * resulting shipment line to the ledger — so the simple action still
 * produces a real, audited stock movement and a real ledger posting.
 *
 * Restricted-grade lines (allowed_set / exact_composition) are left alone
 * — which exact grade mix to pick is a judgment call that must go through
 * the detailed per-grade picker on the order detail page, never guessed
 * here. A line with insufficient saleable stock is simply skipped (not
 * fabricated) and reported back as unfulfilled, rather than failing the
 * whole status update.
 */
export async function autoFulfilAndDispatchOrder(orderId: string, actorUserId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  const fulfilled: { lineId: string; quantity: string }[] = [];
  const skipped: { lineId: string; reason: string }[] = [];

  for (const line of order.lines) {
    if (line.gradeRequirementType !== "none") {
      skipped.push({ lineId: line.id, reason: "restricted grade requirement — needs the detailed picker" });
      continue;
    }

    const existingPicks = await prisma.pickAllocation.findMany({ where: { orderLineId: line.id } });
    const alreadyPicked = sumDecimal(existingPicks.map((p) => p.pickedQty));
    const remaining = line.quantity.minus(alreadyPicked);
    if (remaining.lessThanOrEqualTo(0)) continue;

    const { candidates, fulfilledQty } = await suggestAllocation({ productId: line.productId, quantity: remaining });
    if (candidates.length === 0) {
      skipped.push({ lineId: line.id, reason: "no saleable stock available" });
      continue;
    }

    let lineDispatched = new Decimal(0);
    for (const candidate of candidates) {
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
        quantity: candidate.quantity,
        pickerUserId: actorUserId,
      });
      const { shipmentLine } = await dispatchPickAllocation({
        pickAllocationId: pick.id,
        quantity: candidate.quantity,
        actorUserId,
      });
      await postSaleDispatch(shipmentLine.id);
      lineDispatched = lineDispatched.plus(candidate.quantity);
      void reservation;
    }

    fulfilled.push({ lineId: line.id, quantity: lineDispatched.toString() });
    if (fulfilledQty.lessThan(remaining)) {
      skipped.push({ lineId: line.id, reason: `only ${fulfilledQty.toString()} of ${remaining.toString()} outstanding pieces had saleable stock` });
    }
  }

  return { fulfilled, skipped };
}
