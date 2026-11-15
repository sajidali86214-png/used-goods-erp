import { prisma } from "../../lib/prisma.js";
import { runSerializable } from "../../lib/transaction.js";

/**
 * Reverses a GRN line's entire stock and cost-layer impact so a receiving
 * mistake (wrong qty, wrong grade, wrong bin, wrong supplier) can be
 * corrected by re-receiving it right, instead of living with it forever
 * (spec section 4: "Correct posted receipts through controlled adjustments
 * or reversals, preserving stock and financial history").
 *
 * Only allowed while the received stock is still exactly as it arrived —
 * untouched by grading (no split cost layers), undispatched (quantityRemaining
 * still equals quantityOriginal), and unreserved. Once any of those has
 * happened, a straight reversal would misstate real grading/sales history,
 * so this intentionally refuses and points to Grade Transfer or Returns
 * instead, rather than guessing how to unwind it.
 */
export async function reverseGrnLineReceipt(params: { grnLineId: string; reason: string; actorUserId: string }) {
  return runSerializable(async (tx) => {
    const grnLine = await tx.gRNLine.findUniqueOrThrow({
      where: { id: params.grnLineId },
      include: { lots: { include: { costLayers: { include: { splitInto: true } } } } },
    });

    if (grnLine.lots.length === 0) {
      throw new Error("This GRN line was never received into stock — nothing to reverse here. Edit the GRN line directly if it just needs a correction.");
    }

    const allCostLayers = grnLine.lots.flatMap((lot) => lot.costLayers);
    for (const costLayer of allCostLayers) {
      if (costLayer.splitInto.length > 0) {
        throw new Error(
          `Cannot reverse this line: its stock has already been graded/split. Use Grade Transfer or Returns to correct it instead.`,
        );
      }
      if (!costLayer.quantityRemaining.equals(costLayer.quantityOriginal)) {
        throw new Error(
          `Cannot reverse this line: some of this stock has already been dispatched (sold). Use the Returns flow to correct it instead.`,
        );
      }
    }

    for (const costLayer of allCostLayers) {
      const states = await tx.stockState.findMany({ where: { costLayerId: costLayer.id } });
      for (const state of states) {
        if (state.reservedQty.greaterThan(0)) {
          throw new Error("Cannot reverse this line: some of this stock is reserved against an order. Release the reservation first.");
        }
        if (state.onHandQty.greaterThan(0)) {
          await tx.stockMovement.create({
            data: {
              type: "receipt_reversal",
              productId: state.productId,
              gradeId: state.gradeId,
              binId: state.binId,
              costLayerId: state.costLayerId,
              quantity: state.onHandQty,
              relatedDocumentType: "GRNLine",
              relatedDocumentId: grnLine.id,
              actorUserId: params.actorUserId,
            },
          });
        }
        await tx.stockState.update({ where: { id: state.id }, data: { onHandQty: 0, version: { increment: 1 } } });
      }
      await tx.costLayer.update({ where: { id: costLayer.id }, data: { quantityRemaining: 0 } });
    }

    const before = { receivedQty: grnLine.receivedQty.toString(), rejectedQty: grnLine.rejectedQty.toString(), gradeId: grnLine.gradeId };
    const updated = await tx.gRNLine.update({
      where: { id: grnLine.id },
      data: {
        receivedQty: 0,
        rejectedQty: 0,
        inspectionNotes: [grnLine.inspectionNotes, `[Reversed: ${params.reason}]`].filter(Boolean).join(" "),
      },
    });

    await tx.auditEvent.create({
      data: {
        entityType: "GRNLine",
        entityId: grnLine.id,
        action: "reverse_receipt",
        actorUserId: params.actorUserId,
        reason: params.reason,
        beforeJson: before,
        afterJson: { receivedQty: "0", rejectedQty: "0" },
      },
    });

    return updated;
  });
}
