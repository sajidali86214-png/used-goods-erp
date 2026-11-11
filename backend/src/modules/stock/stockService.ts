import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { runSerializable } from "../../lib/transaction.js";
import { Decimal, sumDecimal, assertEqual, assertNonNegative } from "../../lib/money.js";

interface ReceiveToInspectionInput {
  grnLineId?: string; // omit for opening-stock lots with no GRN (spec section 3.2)
  productId: string;
  gradeId?: string; // known grade mix at receipt (e.g. supplier-sorted AB/C bales) — defaults to Ungraded/Inspection
  supplierId?: string;
  originalCurrencyId: string;
  sourceUnitPrice: Decimal | number;
  exchangeRate: Decimal | number; // PKR per 1 unit of originalCurrencyId, locked now
  landedFreightTotal?: Decimal | number; // apportioned across this GRN's lines elsewhere; this is this line's share
  quantity: Decimal | number;
  binId: string;
  lotCode: string;
  actorUserId: string;
}

/**
 * Creates a Lot + its initial CostLayer (grade = UNGRADED) from a GRN line,
 * and records the receiving movement. Landed cost = (price*qty + freight)/qty,
 * fixed on the cost layer at creation (spec section 6.4 worked example).
 */
export async function receiveToInspection(input: ReceiveToInspectionInput) {
  return runSerializable(async (tx) => {
    const receiptGrade = input.gradeId
      ? await tx.grade.findUniqueOrThrow({ where: { id: input.gradeId } })
      : await tx.grade.findUniqueOrThrow({ where: { code: "UNGRADED" } });

    const qty = new Decimal(input.quantity);
    const unitPrice = new Decimal(input.sourceUnitPrice);
    const freight = new Decimal(input.landedFreightTotal ?? 0);
    const landedUnitCost = unitPrice.plus(freight.div(qty));

    const lot = await tx.lot.create({
      data: {
        lotCode: input.lotCode,
        grnLineId: input.grnLineId,
        supplierId: input.supplierId,
        productId: input.productId,
        originalCurrencyId: input.originalCurrencyId,
        sourceUnitPrice: unitPrice,
        exchangeRate: new Decimal(input.exchangeRate),
      },
    });

    if (!freight.isZero()) {
      await tx.landedCostAllocation.create({
        data: {
          lotId: lot.id,
          costType: "freight",
          amount: freight,
          currencyId: input.originalCurrencyId,
          approvedByUserId: input.actorUserId,
        },
      });
    }

    const costLayer = await tx.costLayer.create({
      data: {
        lotId: lot.id,
        gradeId: receiptGrade.id,
        binId: input.binId,
        quantityOriginal: qty,
        quantityRemaining: qty,
        unitCost: landedUnitCost,
      },
    });

    await tx.stockMovement.create({
      data: {
        type: "receive_to_inspection",
        productId: input.productId,
        gradeId: receiptGrade.id,
        binId: input.binId,
        costLayerId: costLayer.id,
        quantity: qty,
        relatedDocumentType: input.grnLineId ? "GRNLine" : "OpeningStock",
        relatedDocumentId: input.grnLineId ?? lot.id,
        actorUserId: input.actorUserId,
      },
    });

    await upsertStockState(tx, {
      productId: input.productId,
      gradeId: receiptGrade.id,
      binId: input.binId,
      costLayerId: costLayer.id,
      state: "inspection",
      onHandDelta: qty,
    });

    return { lot, costLayer };
  });
}

interface GradeSplit {
  gradeId: string;
  binId: string;
  quantity: Decimal | number;
}

interface GradeTransferInput {
  sourceCostLayerId: string;
  splits: GradeSplit[];
  actorUserId: string;
  destinationState?: string; // defaults to "saleable"
}

/**
 * Splits a cost layer's remaining quantity across one or more grade/bin
 * destinations at the SAME unit cost. Acceptance test #1: quantity and total
 * cost are conserved; grading alone never changes unit cost.
 */
export async function gradeTransfer(input: GradeTransferInput) {
  return runSerializable(async (tx) => {
    const source = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.sourceCostLayerId },
      include: { lot: true },
    });
    const productId = source.lot.productId;

    const splitQuantities = input.splits.map((s) => new Decimal(s.quantity));
    const totalSplit = sumDecimal(splitQuantities);

    assertEqual(
      totalSplit,
      source.quantityRemaining,
      "Grading transfer must conserve the full remaining quantity",
    );

    const remainingAfter = source.quantityRemaining.minus(totalSplit);
    assertNonNegative(remainingAfter, "Source cost layer would go negative");

    await tx.costLayer.update({
      where: { id: source.id },
      data: { quantityRemaining: remainingAfter },
    });

    await tx.stockMovement.create({
      data: {
        type: "grading_transfer",
        productId,
        gradeId: source.gradeId,
        binId: source.binId,
        costLayerId: source.id,
        quantity: totalSplit,
        relatedDocumentType: "CostLayer",
        relatedDocumentId: source.id,
        actorUserId: input.actorUserId,
      },
    });

    await upsertStockState(tx, {
      productId,
      gradeId: source.gradeId,
      binId: source.binId,
      costLayerId: source.id,
      state: "inspection",
      onHandDelta: totalSplit.negated(),
    });

    const destinationState = input.destinationState ?? "saleable";
    const created = [];

    for (let i = 0; i < input.splits.length; i++) {
      const split = input.splits[i]!;
      const qty = splitQuantities[i]!;

      const newLayer = await tx.costLayer.create({
        data: {
          lotId: source.lotId,
          gradeId: split.gradeId,
          binId: split.binId,
          quantityOriginal: qty,
          quantityRemaining: qty,
          unitCost: source.unitCost, // conserved — grading never changes cost
          splitFromLayerId: source.id,
        },
      });

      await tx.stockMovement.create({
        data: {
          type: "grading_transfer",
          productId,
          gradeId: split.gradeId,
          binId: split.binId,
          costLayerId: newLayer.id,
          quantity: qty,
          relatedDocumentType: "CostLayer",
          relatedDocumentId: source.id,
          actorUserId: input.actorUserId,
        },
      });

      await upsertStockState(tx, {
        productId,
        gradeId: split.gradeId,
        binId: split.binId,
        costLayerId: newLayer.id,
        state: destinationState,
        onHandDelta: qty,
      });

      created.push(newLayer);
    }

    return { source: { id: source.id, quantityRemaining: remainingAfter }, created };
  });
}

interface WriteOffInput {
  costLayerId: string;
  state: string;
  quantity: Decimal | number;
  actorUserId: string;
  reason: string;
}

/** Posts a write-off/adjustment movement. Never allows on-hand to go negative. */
export async function writeOff(input: WriteOffInput) {
  return runSerializable(async (tx) => {
    const costLayer = await tx.costLayer.findUniqueOrThrow({
      where: { id: input.costLayerId },
      include: { lot: true },
    });
    const productId = costLayer.lot.productId;
    const qty = new Decimal(input.quantity);

    const remainingAfter = costLayer.quantityRemaining.minus(qty);
    assertNonNegative(remainingAfter, "Write-off would take cost layer below zero");

    await tx.costLayer.update({
      where: { id: costLayer.id },
      data: { quantityRemaining: remainingAfter },
    });

    await tx.stockMovement.create({
      data: {
        type: "write_off",
        productId,
        gradeId: costLayer.gradeId,
        binId: costLayer.binId,
        costLayerId: costLayer.id,
        quantity: qty,
        relatedDocumentType: "WriteOffReason",
        relatedDocumentId: randomUUID(),
        actorUserId: input.actorUserId,
      },
    });

    await upsertStockState(tx, {
      productId,
      gradeId: costLayer.gradeId,
      binId: costLayer.binId,
      costLayerId: costLayer.id,
      state: input.state,
      onHandDelta: qty.negated(),
    });

    return { costLayerId: costLayer.id, quantityRemaining: remainingAfter };
  });
}

async function upsertStockState(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    gradeId: string;
    binId: string;
    costLayerId: string;
    state: string;
    onHandDelta: Decimal;
  },
) {
  const existing = await tx.stockState.findUnique({
    where: {
      productId_gradeId_binId_costLayerId_state: {
        productId: params.productId,
        gradeId: params.gradeId,
        binId: params.binId,
        costLayerId: params.costLayerId,
        state: params.state,
      },
    },
  });

  if (!existing) {
    const onHandQty = params.onHandDelta;
    assertNonNegative(onHandQty, "New stock state cannot start negative");
    return tx.stockState.create({
      data: {
        productId: params.productId,
        gradeId: params.gradeId,
        binId: params.binId,
        costLayerId: params.costLayerId,
        state: params.state,
        onHandQty,
      },
    });
  }

  const onHandQty = existing.onHandQty.plus(params.onHandDelta);
  assertNonNegative(onHandQty, "Stock state on-hand quantity cannot go negative");

  return tx.stockState.update({
    where: { id: existing.id },
    data: { onHandQty, version: { increment: 1 } },
  });
}
