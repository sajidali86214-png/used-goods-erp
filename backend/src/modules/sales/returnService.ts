import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertEqual, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";

export async function createReturnRequest(params: { orderId: string; requestedByUserId: string }) {
  return prisma.returnRequest.create({
    data: {
      orderId: params.orderId,
      requestedByUserId: params.requestedByUserId,
      status: "requested",
    },
  });
}

interface ReceiveReturnLineInput {
  returnRequestId: string;
  orderLineId: string;
  costLayerId: string; // the cost layer these pieces were originally dispatched from
  sourcePickAllocationId?: string; // omit only when origin is uncertain
  originGradeId: string;
  quantity: Decimal | number;
  originUncertain?: boolean;
  assumptionNotes?: string;
  actorUserId: string;
}

/**
 * Physical receipt of a return into inspection — never a current replacement
 * cost, always the original cost layer (spec section 8). If the exact lot
 * origin can't be identified from a multi-lot dispatch, `sourcePickAllocationId`
 * is omitted but `originUncertain` + `assumptionNotes` are then required
 * (acceptance test #11) — this is an explicit, recorded assumption, not
 * silently-inferred traceability.
 */
export async function receiveReturnLine(input: ReceiveReturnLineInput) {
  if (!input.sourcePickAllocationId && !input.originUncertain) {
    throw new Error(
      "Either sourcePickAllocationId must be given, or originUncertain + assumptionNotes must be set",
    );
  }
  if (input.originUncertain && !input.assumptionNotes) {
    throw new Error("assumptionNotes is required when originUncertain is true");
  }

  return runSerializable(async (tx) => {
    const qty = new Decimal(input.quantity);

    if (input.sourcePickAllocationId) {
      const pick = await tx.pickAllocation.findUniqueOrThrow({
        where: { id: input.sourcePickAllocationId },
      });
      if (pick.costLayerId !== input.costLayerId) {
        throw new Error("costLayerId does not match the referenced pick allocation's cost layer");
      }
    }

    // Returns can never exceed dispatched quantity net of prior returns (spec section 8).
    const orderLine = await tx.salesOrderLine.findUniqueOrThrow({ where: { id: input.orderLineId } });
    const dispatchedLines = await tx.shipmentLine.findMany({ where: { orderLineId: input.orderLineId } });
    const totalDispatched = sumDecimal(dispatchedLines.map((l) => l.quantity));
    const priorReturns = await tx.returnLine.findMany({ where: { orderLineId: input.orderLineId } });
    const totalReturnedSoFar = sumDecimal(priorReturns.map((r) => r.quantity));
    if (totalReturnedSoFar.plus(qty).greaterThan(totalDispatched)) {
      throw new Error(
        `Cannot return ${qty.toString()} — only ${totalDispatched.minus(totalReturnedSoFar).toString()} of this line's dispatched quantity remains returnable`,
      );
    }

    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.costLayerId },
      include: { lot: true },
    });
    const productId = costLayer.lot.productId;
    const binId = costLayer.binId;

    // Reverses the dispatch-time removal: this stock is back in the business.
    await tx.costLayer.update({
      where: { id: costLayer.id },
      data: { quantityRemaining: costLayer.quantityRemaining.plus(qty) },
    });

    const existingInspectionState = await tx.stockState.findUnique({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: input.originGradeId,
          binId,
          costLayerId: input.costLayerId,
          state: "return_inspection",
        },
      },
    });
    if (existingInspectionState) {
      await tx.stockState.update({
        where: { id: existingInspectionState.id },
        data: { onHandQty: existingInspectionState.onHandQty.plus(qty), version: { increment: 1 } },
      });
    } else {
      await tx.stockState.create({
        data: {
          productId,
          gradeId: input.originGradeId,
          binId,
          costLayerId: input.costLayerId,
          state: "return_inspection",
          onHandQty: qty,
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        type: "return_receipt",
        productId,
        gradeId: input.originGradeId,
        binId,
        costLayerId: input.costLayerId,
        quantity: qty,
        relatedDocumentType: "ReturnRequest",
        relatedDocumentId: input.returnRequestId,
        actorUserId: input.actorUserId,
      },
    });

    return tx.returnLine.create({
      data: {
        returnRequestId: input.returnRequestId,
        orderLineId: input.orderLineId,
        sourcePickAllocationId: input.sourcePickAllocationId,
        costLayerId: input.costLayerId,
        originGradeId: input.originGradeId,
        quantity: qty,
        originUncertain: input.originUncertain ?? false,
        assumptionNotes: input.assumptionNotes,
      },
    });
  });
}

interface InspectionOutcome {
  inspectedGradeId: string;
  quantity: Decimal | number;
  disposition: "resaleable" | "repair" | "damaged";
}

/**
 * Inspects a received return line, splitting it (like a grading transfer)
 * across one or more outcomes that must sum to the line's full quantity.
 * Worked example (acceptance test #10): 5 Grade A pieces return, inspection
 * finds 3 are still A and 2 are now B — both keep their original cost basis.
 */
export async function inspectReturnLine(params: {
  returnLineId: string;
  outcomes: InspectionOutcome[];
  actorUserId: string;
}) {
  return runSerializable(async (tx) => {
    const returnLine = await tx.returnLine.findUniqueOrThrow({ where: { id: params.returnLineId } });
    if (returnLine.disposition !== null) {
      throw new Error("This return line has already been inspected");
    }

    const outcomeQuantities = params.outcomes.map((o) => new Decimal(o.quantity));
    const totalOutcomeQty = sumDecimal(outcomeQuantities);
    assertEqual(totalOutcomeQty, returnLine.quantity, "Inspection outcomes must conserve the full returned quantity");

    const sourceCostLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: returnLine.costLayerId },
      include: { lot: true },
    });
    const productId = sourceCostLayer.lot.productId;
    const binId = sourceCostLayer.binId;

    const inspectionState = await tx.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId,
          gradeId: returnLine.originGradeId,
          binId,
          costLayerId: sourceCostLayer.id,
          state: "return_inspection",
        },
      },
    });
    const inspectionAfter = inspectionState.onHandQty.minus(totalOutcomeQty);
    assertNonNegative(inspectionAfter, "Inspection would take return_inspection on-hand negative");
    await tx.stockState.update({
      where: { id: inspectionState.id },
      data: { onHandQty: inspectionAfter, version: { increment: 1 } },
    });

    const createdReturnLines = [];

    for (let i = 0; i < params.outcomes.length; i++) {
      const outcome = params.outcomes[i]!;
      const qty = outcomeQuantities[i]!;

      let destinationCostLayer: {
        id: string;
        lotId: string;
        binId: string;
        unitCost: Decimal;
        quantityRemaining: Decimal;
      } = sourceCostLayer;
      if (outcome.inspectedGradeId !== returnLine.originGradeId) {
        // Regrading on return: find-or-create the destination grade's cost
        // layer on the SAME lot, at the SAME unit cost (conserved, like the
        // original grading split — never a current replacement cost).
        const existing = await tx.costLayer.findFirst({
          where: { lotId: sourceCostLayer.lotId, gradeId: outcome.inspectedGradeId, binId },
        });
        if (existing) {
          await tx.costLayer.update({
            where: { id: existing.id },
            data: { quantityRemaining: existing.quantityRemaining.plus(qty) },
          });
          destinationCostLayer = existing;
        } else {
          destinationCostLayer = await tx.costLayer.create({
            data: {
              lotId: sourceCostLayer.lotId,
              gradeId: outcome.inspectedGradeId,
              binId,
              quantityOriginal: qty,
              quantityRemaining: qty,
              unitCost: sourceCostLayer.unitCost,
              splitFromLayerId: sourceCostLayer.id,
            },
          });
        }
        // These units leave the origin-grade layer's identity entirely.
        const originAfter = sourceCostLayer.quantityRemaining.minus(qty);
        assertNonNegative(originAfter, "Regrading on return would take origin cost layer negative");
        await tx.costLayer.update({
          where: { id: sourceCostLayer.id },
          data: { quantityRemaining: originAfter },
        });
      }

      const destinationState =
        outcome.disposition === "resaleable" ? "saleable" : outcome.disposition === "repair" ? "repair" : "damaged";

      const existingDestState = await tx.stockState.findUnique({
        where: {
          productId_gradeId_binId_costLayerId_state: {
            productId,
            gradeId: outcome.inspectedGradeId,
            binId,
            costLayerId: destinationCostLayer.id,
            state: destinationState,
          },
        },
      });
      if (existingDestState) {
        await tx.stockState.update({
          where: { id: existingDestState.id },
          data: { onHandQty: existingDestState.onHandQty.plus(qty), version: { increment: 1 } },
        });
      } else {
        await tx.stockState.create({
          data: {
            productId,
            gradeId: outcome.inspectedGradeId,
            binId,
            costLayerId: destinationCostLayer.id,
            state: destinationState,
            onHandQty: qty,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          type: "return_to_bulk",
          productId,
          gradeId: outcome.inspectedGradeId,
          binId,
          costLayerId: destinationCostLayer.id,
          quantity: qty,
          relatedDocumentType: "ReturnLine",
          relatedDocumentId: returnLine.id,
          actorUserId: params.actorUserId,
        },
      });

      if (i === 0) {
        createdReturnLines.push(
          await tx.returnLine.update({
            where: { id: returnLine.id },
            data: {
              quantity: qty,
              costLayerId: destinationCostLayer.id,
              inspectedGradeId: outcome.inspectedGradeId,
              disposition: outcome.disposition,
            },
          }),
        );
      } else {
        createdReturnLines.push(
          await tx.returnLine.create({
            data: {
              returnRequestId: returnLine.returnRequestId,
              orderLineId: returnLine.orderLineId,
              sourcePickAllocationId: returnLine.sourcePickAllocationId,
              costLayerId: destinationCostLayer.id,
              originGradeId: returnLine.originGradeId,
              inspectedGradeId: outcome.inspectedGradeId,
              quantity: qty,
              disposition: outcome.disposition,
              originUncertain: returnLine.originUncertain,
              assumptionNotes: returnLine.assumptionNotes,
            },
          }),
        );
      }
    }

    return createdReturnLines;
  });
}
