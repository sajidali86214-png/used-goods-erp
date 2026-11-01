import { runSerializable } from "../../lib/transaction.js";
import { Decimal, assertNonNegative } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";

interface CountLineInput {
  productId: string;
  gradeId: string;
  binId: string;
  costLayerId: string;
  countedQty: Decimal | number;
}

/**
 * Snapshots the system's saleable on-hand quantity for each counted
 * (product, grade, bin, cost layer) at count time, so the variance is fixed
 * at the moment of counting even if stock moves again before approval.
 */
export async function createStockCount(params: {
  countDate: Date;
  binId?: string;
  lines: CountLineInput[];
}) {
  const lineData = [];
  for (const line of params.lines) {
    const state = await prisma.stockState.findUnique({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: line.productId,
          gradeId: line.gradeId,
          binId: line.binId,
          costLayerId: line.costLayerId,
          state: "saleable",
        },
      },
    });
    const systemQty = state?.onHandQty ?? new Decimal(0);
    const countedQty = new Decimal(line.countedQty);
    lineData.push({
      productId: line.productId,
      gradeId: line.gradeId,
      costLayerId: line.costLayerId,
      countedQty,
      systemQty,
      varianceQty: countedQty.minus(systemQty),
      // binId is carried via the parent StockCount in this simplified model (single-bin counts)
    });
  }

  return prisma.stockCount.create({
    data: {
      countDate: params.countDate,
      binId: params.binId,
      status: "draft",
      lines: { create: lineData },
    },
    include: { lines: true },
  });
}

export async function submitStockCount(stockCountId: string) {
  const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
  if (count.status !== "draft") {
    throw new Error(`Cannot submit a stock count with status "${count.status}"`);
  }
  return prisma.stockCount.update({ where: { id: stockCountId }, data: { status: "submitted" } });
}

/**
 * The approval gate: variance adjustments are only posted to the ledger
 * here, never at create/submit time (spec section 12/18 — "require
 * approval and preserve the original ledger plus adjustment"). Posts one
 * count_adjustment StockMovement per line with a non-zero variance; the
 * prior movement history is never edited, only appended to.
 */
export async function approveStockCountVariance(params: {
  stockCountId: string;
  approvedByUserId: string;
  binId: string; // the physical bin this count was taken against
}) {
  return runSerializable(async (tx) => {
    const count = await tx.stockCount.findUniqueOrThrow({
      where: { id: params.stockCountId },
      include: { lines: true },
    });
    if (count.status !== "submitted") {
      throw new Error(`Cannot approve a stock count with status "${count.status}" — it must be submitted first`);
    }

    for (const line of count.lines) {
      if (line.varianceQty.isZero()) continue;

      const state = await tx.stockState.findUniqueOrThrow({
        where: {
          productId_gradeId_binId_costLayerId_state: {
            productId: line.productId,
            gradeId: line.gradeId,
            binId: params.binId,
            costLayerId: line.costLayerId,
            state: "saleable",
          },
        },
      });
      const onHandAfter = state.onHandQty.plus(line.varianceQty);
      assertNonNegative(onHandAfter, "Stock count approval would take on-hand negative");

      await tx.stockState.update({
        where: { id: state.id },
        data: { onHandQty: onHandAfter, version: { increment: 1 } },
      });

      const costLayer = await tx.costLayer.findUniqueOrThrow({ where: { id: line.costLayerId } });
      const remainingAfter = costLayer.quantityRemaining.plus(line.varianceQty);
      assertNonNegative(remainingAfter, "Stock count approval would take quantityRemaining negative");
      await tx.costLayer.update({
        where: { id: line.costLayerId },
        data: { quantityRemaining: remainingAfter },
      });

      await tx.stockMovement.create({
        data: {
          type: "count_adjustment",
          productId: line.productId,
          gradeId: line.gradeId,
          binId: params.binId,
          costLayerId: line.costLayerId,
          quantity: line.varianceQty.abs(),
          relatedDocumentType: "StockCount",
          relatedDocumentId: count.id,
          actorUserId: params.approvedByUserId,
        },
      });
    }

    return tx.stockCount.update({
      where: { id: count.id },
      data: { status: "approved", approvedByUserId: params.approvedByUserId },
    });
  });
}
