import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { getAccountBalance } from "../finance/ledgerService.js";

/**
 * Operational dashboard: on-hand/reserved/available by state, across all
 * products (spec section 12). "Available" only applies to the saleable
 * state — other states (inspection/picking/repair/damaged/...) are shown
 * as plain on-hand totals since nothing is ever reserved against them.
 */
export async function getStockSummary() {
  const states = await prisma.stockState.findMany();
  const byState = new Map<string, { onHandQty: Decimal; reservedQty: Decimal }>();

  for (const s of states) {
    const bucket = byState.get(s.state) ?? { onHandQty: new Decimal(0), reservedQty: new Decimal(0) };
    bucket.onHandQty = bucket.onHandQty.plus(s.onHandQty);
    bucket.reservedQty = bucket.reservedQty.plus(s.reservedQty);
    byState.set(s.state, bucket);
  }

  return [...byState.entries()].map(([state, b]) => ({
    state,
    onHandQty: b.onHandQty,
    reservedQty: b.reservedQty,
    availableQty: state === "saleable" ? b.onHandQty.minus(b.reservedQty) : null,
  }));
}

/**
 * Unsold inventory value = sum(quantityRemaining * unitCost) across every
 * cost layer still owned by the business (spec section 12: "unsold
 * inventory value", distinguished from recognized sales / cash received).
 * Grouped by product for a lot-level drill-down.
 */
export async function getInventoryValuation() {
  const costLayers = await prisma.costLayer.findMany({ include: { lot: { include: { product: true } } } });

  const byProduct = new Map<string, { productId: string; skuCode: string; quantityRemaining: Decimal; value: Decimal }>();
  for (const cl of costLayers) {
    if (cl.quantityRemaining.isZero()) continue;
    const key = cl.lot.productId;
    const bucket =
      byProduct.get(key) ??
      { productId: key, skuCode: cl.lot.product.skuCode, quantityRemaining: new Decimal(0), value: new Decimal(0) };
    bucket.quantityRemaining = bucket.quantityRemaining.plus(cl.quantityRemaining);
    bucket.value = bucket.value.plus(cl.quantityRemaining.times(cl.unitCost));
    byProduct.set(key, bucket);
  }

  const lines = [...byProduct.values()];
  return { lines, totalValue: sumDecimal(lines.map((l) => l.value)) };
}

/** Purchase orders with outstanding (ordered - received) quantity on any line. */
export async function getPendingReceipts() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["approved", "draft"] } },
    include: { lines: true, supplier: true },
  });

  const results = [];
  for (const po of pos) {
    const lineStatuses = [];
    for (const line of po.lines) {
      const grnLines = await prisma.gRNLine.findMany({ where: { poLineId: line.id } });
      const receivedQty = sumDecimal(grnLines.map((g) => g.receivedQty));
      const outstandingQty = line.orderedQty.minus(receivedQty);
      if (outstandingQty.greaterThan(0)) {
        lineStatuses.push({ lineId: line.id, productId: line.productId, outstandingQty });
      }
    }
    if (lineStatuses.length > 0) {
      results.push({ poId: po.id, poNumber: po.poNumber, supplierName: po.supplier.name, lines: lineStatuses });
    }
  }
  return results;
}

/** Sales orders not yet fully dispatched/delivered. */
export async function getUnfulfilledOrders() {
  return prisma.salesOrder.findMany({
    where: {
      status: { in: ["draft", "confirmed", "partially_cancelled"] },
      fulfilmentStatus: { notIn: ["delivered"] },
    },
    include: { customer: true, lines: true },
  });
}

/** Return requests not yet resolved. */
export async function getPendingReturns() {
  return prisma.returnRequest.findMany({
    where: { status: { not: "resolved" } },
    include: { lines: true, order: { include: { customer: true } } },
  });
}

/** Refunds requested/partially refunded but not yet fully paid out. */
export async function getPendingRefunds() {
  return prisma.refund.findMany({ where: { status: { in: ["pending", "partially_refunded"] } } });
}

async function sumEntriesForAccountCode(code: string, params: { from?: Date; to?: Date }) {
  const account = await prisma.account.findUniqueOrThrow({ where: { code } });
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      accountId: account.id,
      postedAt: { gte: params.from, lte: params.to },
    },
  });
  const debits = sumDecimal(entries.filter((e) => e.direction === "debit").map((e) => e.amount));
  const credits = sumDecimal(entries.filter((e) => e.direction === "credit").map((e) => e.amount));
  return { debits, credits };
}

/**
 * Financial dashboard, PKR only (spec section 12) for the given date range:
 * net sales, COGS, gross profit, operating expenses, operating result,
 * receivables, supplier advances outstanding, and unsold inventory value.
 * Keeps booked-order-value, recognized sales, and cash received distinct —
 * this reads only posted ledger entries, never order totals.
 */
export async function getFinancialSummary(params: { from?: Date; to?: Date }) {
  const [sales, returns, cogs, opex, bankCharges] = await Promise.all([
    sumEntriesForAccountCode("SALES_REVENUE", params),
    sumEntriesForAccountCode("SALES_RETURNS", params),
    sumEntriesForAccountCode("COGS", params),
    sumEntriesForAccountCode("OPERATING_EXPENSES", params),
    sumEntriesForAccountCode("BANK_CHARGES", params),
  ]);

  const grossSales = sales.credits;
  const netSales = grossSales.minus(returns.debits);
  const totalCogs = cogs.debits;
  const grossProfit = netSales.minus(totalCogs);
  const totalOpex = opex.debits.plus(bankCharges.debits);
  const operatingResult = grossProfit.minus(totalOpex);

  const receivablesAccount = await prisma.account.findUniqueOrThrow({ where: { code: "ACCOUNTS_RECEIVABLE" } });
  const supplierAdvancesAccount = await prisma.account.findUniqueOrThrow({ where: { code: "SUPPLIER_ADVANCES" } });
  const receivables = await getAccountBalance(receivablesAccount.id);
  const supplierAdvancesOutstanding = await getAccountBalance(supplierAdvancesAccount.id);

  const inventoryValuation = await getInventoryValuation();

  return {
    periodFrom: params.from ?? null,
    periodTo: params.to ?? null,
    grossSales,
    netSales,
    cogs: totalCogs,
    grossProfit,
    operatingExpenses: totalOpex,
    operatingResult,
    receivables,
    supplierAdvancesOutstanding,
    unsoldInventoryValue: inventoryValuation.totalValue,
  };
}
