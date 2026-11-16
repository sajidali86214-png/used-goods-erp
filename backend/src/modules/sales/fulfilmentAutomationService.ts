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
 * Restricted-grade lines only need a human when the mix is genuinely
 * ambiguous — an allowed_set with more than one grade to choose from. An
 * allowed_set with exactly one grade, or an exact_composition (which
 * already states exactly how many of each grade), has nothing left to
 * decide, so those are allocated automatically too, grade-by-grade. Only
 * the genuinely ambiguous case is left for the detailed per-grade picker on
 * the order detail page. A line with insufficient saleable stock is simply
 * skipped (not fabricated) and reported back as unfulfilled, rather than
 * failing the whole status update.
 */
export async function autoFulfilAndDispatchOrder(orderId: string, actorUserId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  const fulfilled: { lineId: string; quantity: string }[] = [];
  const skipped: { lineId: string; reason: string }[] = [];

  async function allocateAndDispatch(
    line: (typeof order.lines)[number],
    quantity: Decimal,
    allowedGradeIds: string[] | undefined,
  ): Promise<Decimal> {
    const { candidates } = await suggestAllocation({ productId: line.productId, quantity, allowedGradeIds });
    let dispatched = new Decimal(0);
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
      await postSaleDispatch(shipmentLine.id, actorUserId);
      dispatched = dispatched.plus(candidate.quantity);
      void reservation;
    }
    return dispatched;
  }

  for (const line of order.lines) {
    const existingPicks = await prisma.pickAllocation.findMany({ where: { orderLineId: line.id } });

    if (line.gradeRequirementType === "exact_composition" && line.exactGradeQuantities) {
      const required = line.exactGradeQuantities as Record<string, string | number>;
      let lineDispatched = new Decimal(0);
      let lineRequired = new Decimal(0);
      for (const [gradeId, requiredQty] of Object.entries(required)) {
        const req = new Decimal(requiredQty);
        lineRequired = lineRequired.plus(req);
        const alreadyPickedForGrade = sumDecimal(existingPicks.filter((p) => p.gradeId === gradeId).map((p) => p.pickedQty));
        const remaining = req.minus(alreadyPickedForGrade);
        if (remaining.lessThanOrEqualTo(0)) continue;
        lineDispatched = lineDispatched.plus(await allocateAndDispatch(line, remaining, [gradeId]));
      }
      if (lineDispatched.greaterThan(0)) fulfilled.push({ lineId: line.id, quantity: lineDispatched.toString() });
      const alreadyPicked = sumDecimal(existingPicks.map((p) => p.pickedQty));
      if (alreadyPicked.plus(lineDispatched).lessThan(lineRequired)) {
        skipped.push({ lineId: line.id, reason: "not enough saleable stock in one or more required grades" });
      }
      continue;
    }

    if (line.gradeRequirementType === "allowed_set" && line.allowedGradeIds.length !== 1) {
      skipped.push({ lineId: line.id, reason: "restricted grade requirement — needs the detailed picker" });
      continue;
    }

    const allowedGradeIds = line.gradeRequirementType === "allowed_set" ? line.allowedGradeIds : undefined;
    const alreadyPicked = sumDecimal(existingPicks.map((p) => p.pickedQty));
    const remaining = line.quantity.minus(alreadyPicked);
    if (remaining.lessThanOrEqualTo(0)) continue;

    const { fulfilledQty } = await suggestAllocation({ productId: line.productId, quantity: remaining, allowedGradeIds });
    if (fulfilledQty.lessThanOrEqualTo(0)) {
      skipped.push({ lineId: line.id, reason: "no saleable stock available" });
      continue;
    }

    const lineDispatched = await allocateAndDispatch(line, remaining, allowedGradeIds);
    fulfilled.push({ lineId: line.id, quantity: lineDispatched.toString() });
    if (fulfilledQty.lessThan(remaining)) {
      skipped.push({ lineId: line.id, reason: `only ${fulfilledQty.toString()} of ${remaining.toString()} outstanding pieces had saleable stock` });
    }
  }

  return { fulfilled, skipped };
}
