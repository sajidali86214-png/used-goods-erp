import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { getAccountBalance } from "../finance/ledgerService.js";
import { computeOrderCostSummary } from "../sales/salesOrderService.js";

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

/**
 * Same unsold-inventory valuation as getInventoryValuation, grouped by
 * category instead of product — "how much of our money is tied up in
 * Bags vs Shoes", with each category's % contribution to the total, for
 * the dashboard's category-level inventory view.
 */
export async function getInventoryValueByCategory() {
  const costLayers = await prisma.costLayer.findMany({
    include: { lot: { include: { product: { include: { category: true } } } } },
  });

  const byCategory = new Map<string, { categoryId: string; categoryName: string; quantityRemaining: Decimal; value: Decimal }>();
  for (const cl of costLayers) {
    if (cl.quantityRemaining.isZero()) continue;
    const category = cl.lot.product.category;
    const key = category?.id ?? "uncategorized";
    const bucket =
      byCategory.get(key) ??
      { categoryId: key, categoryName: category?.name ?? "Uncategorized", quantityRemaining: new Decimal(0), value: new Decimal(0) };
    bucket.quantityRemaining = bucket.quantityRemaining.plus(cl.quantityRemaining);
    bucket.value = bucket.value.plus(cl.quantityRemaining.times(cl.unitCost));
    byCategory.set(key, bucket);
  }

  const totalValue = sumDecimal([...byCategory.values()].map((l) => l.value));
  const lines = [...byCategory.values()]
    .map((l) => ({
      ...l,
      contributionPct: totalValue.isZero() ? new Decimal(0) : l.value.times(100).div(totalValue).toDecimalPlaces(2),
    }))
    .sort((a, b) => b.value.minus(a.value).toNumber());

  return { lines, totalValue };
}

/**
 * Per-product stock levels across all grades/bins/states, for the main
 * inventory list view. Deliberately excludes unit cost — that stays behind
 * cost.view (see getInventoryValuation) — so a stock.count-only role (e.g.
 * a picker) can see quantities without seeing valuation.
 */
export async function getStockLevelsByProduct() {
  const states = await prisma.stockState.findMany({ include: { product: true } });
  const byProduct = new Map<
    string,
    { productId: string; skuCode: string; name: string; onHandQty: Decimal; reservedQty: Decimal; availableQty: Decimal }
  >();

  for (const s of states) {
    const key = s.productId;
    const bucket =
      byProduct.get(key) ??
      { productId: key, skuCode: s.product.skuCode, name: s.product.name, onHandQty: new Decimal(0), reservedQty: new Decimal(0), availableQty: new Decimal(0) };
    bucket.onHandQty = bucket.onHandQty.plus(s.onHandQty);
    bucket.reservedQty = bucket.reservedQty.plus(s.reservedQty);
    if (s.state === "saleable") bucket.availableQty = bucket.availableQty.plus(s.onHandQty.minus(s.reservedQty));
    byProduct.set(key, bucket);
  }

  return [...byProduct.values()]
    .filter((b) => b.onHandQty.greaterThan(0))
    .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
}

/** Grade/bin/state breakdown for a single product — the inventory detail drill-down. */
export async function getProductStockDetail(productId: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const states = await prisma.stockState.findMany({
    where: { productId },
    include: { grade: true, bin: true },
  });

  const rows = states
    .filter((s) => s.onHandQty.greaterThan(0) || s.reservedQty.greaterThan(0))
    .map((s) => ({
      state: s.state,
      gradeId: s.gradeId,
      gradeCode: s.grade.code,
      binId: s.binId,
      binCode: s.bin.code,
      costLayerId: s.costLayerId,
      onHandQty: s.onHandQty,
      reservedQty: s.reservedQty,
      availableQty: s.state === "saleable" ? s.onHandQty.minus(s.reservedQty) : null,
    }));

  return { productId: product.id, skuCode: product.skuCode, name: product.name, rows };
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

/**
 * Stock aging: for each product, how long its oldest still-owned cost layer
 * has been sitting (days since that layer was created), plus the total
 * quantity still remaining across all its layers (any state) and its value.
 * Spec section 12 lists "stock aging" as an operational report.
 */
export async function getStockAging() {
  const costLayers = await prisma.costLayer.findMany({
    where: { quantityRemaining: { gt: 0 } },
    include: { lot: { include: { product: true } } },
  });

  const now = Date.now();
  const byProduct = new Map<
    string,
    { productId: string; skuCode: string; oldestAgeDays: number; quantityRemaining: Decimal; value: Decimal }
  >();

  for (const cl of costLayers) {
    const ageDays = Math.floor((now - cl.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const key = cl.lot.productId;
    const bucket =
      byProduct.get(key) ??
      { productId: key, skuCode: cl.lot.product.skuCode, oldestAgeDays: 0, quantityRemaining: new Decimal(0), value: new Decimal(0) };
    bucket.oldestAgeDays = Math.max(bucket.oldestAgeDays, ageDays);
    bucket.quantityRemaining = bucket.quantityRemaining.plus(cl.quantityRemaining);
    bucket.value = bucket.value.plus(cl.quantityRemaining.times(cl.unitCost));
    byProduct.set(key, bucket);
  }

  return [...byProduct.values()].sort((a, b) => b.oldestAgeDays - a.oldestAgeDays);
}

/**
 * Per-supplier: total advances paid, how much of that is still unapplied
 * to an invoice, and how many purchase orders still have outstanding
 * (ordered - received) quantity. Spec section 12: "supplier performance".
 */
export async function getSupplierBalances() {
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true } });
  const results = [];

  for (const supplier of suppliers) {
    const advances = await prisma.supplierAdvance.findMany({ where: { supplierId: supplier.id } });
    const invoices = await prisma.supplierInvoice.findMany({ where: { supplierId: supplier.id } });
    const totalAdvancesPaid = sumDecimal(advances.map((a) => a.amount));
    const totalMatched = sumDecimal(invoices.map((i) => i.matchedAdvance));
    const unappliedAdvance = totalAdvancesPaid.minus(totalMatched);

    const openPos = await prisma.purchaseOrder.findMany({
      where: { supplierId: supplier.id, status: { in: ["draft", "approved"] } },
      include: { lines: true },
    });
    let openPoCount = 0;
    for (const po of openPos) {
      let hasOutstanding = false;
      for (const line of po.lines) {
        const grnLines = await prisma.gRNLine.findMany({ where: { poLineId: line.id } });
        const receivedQty = sumDecimal(grnLines.map((g) => g.receivedQty));
        if (line.orderedQty.minus(receivedQty).greaterThan(0)) hasOutstanding = true;
      }
      if (hasOutstanding) openPoCount += 1;
    }

    if (totalAdvancesPaid.greaterThan(0) || openPoCount > 0) {
      results.push({ supplierId: supplier.id, supplierName: supplier.name, totalAdvancesPaid, unappliedAdvance, openPoCount });
    }
  }

  return results;
}

/**
 * Per-customer: booked order value — net of each order's discount, shipping,
 * and commission (what the customer is actually expected to pay, matching
 * computeOrderCostSummary's netTotal — not bundle-allocation-aware, a
 * documented simplification) vs. amount actually received via
 * PaymentAllocation, giving an outstanding balance. Spec section 12:
 * "customer balances".
 */
export async function getCustomerBalances() {
  const customers = await prisma.customer.findMany({ where: { isActive: true } });
  const results = [];

  for (const customer of customers) {
    const orders = await prisma.salesOrder.findMany({
      where: { customerId: customer.id },
      include: { lines: true },
    });
    if (orders.length === 0) continue;

    let bookedValue = new Decimal(0);
    for (const order of orders) {
      bookedValue = bookedValue.plus(computeOrderCostSummary(order).netTotal);
    }

    const ordersNeedingAllocationLookup = orders.filter((o) => o.paymentReceivedAmount === null);
    const allocations = await prisma.paymentAllocation.findMany({
      where: { orderId: { in: ordersNeedingAllocationLookup.map((o) => o.id) } },
    });
    let received = new Decimal(0);
    for (const order of orders) {
      if (order.paymentReceivedAmount !== null) {
        received = received.plus(order.paymentReceivedAmount);
      } else {
        received = received.plus(sumDecimal(allocations.filter((a) => a.orderId === order.id).map((a) => a.amount)));
      }
    }

    if (bookedValue.greaterThan(0) || received.greaterThan(0)) {
      results.push({
        customerId: customer.id,
        customerName: customer.name,
        bookedValue,
        received,
        outstanding: bookedValue.minus(received),
      });
    }
  }

  return results;
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
 * Posted operating expenses for a period, grouped by category — e.g.
 * salaries, commuting, fuel. Reads only posted ledger entries (Expense rows
 * that were actually posted via postExpense), same "posted records only"
 * rule as getFinancialSummary, so draft/unposted expenses never show here.
 */
export async function getExpensesByCategory(params: { from?: Date; to?: Date }) {
  const operatingExpenses = await prisma.account.findUniqueOrThrow({ where: { code: "OPERATING_EXPENSES" } });
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      accountId: operatingExpenses.id,
      direction: "debit",
      relatedDocumentType: "Expense",
      postedAt: { gte: params.from, lte: params.to },
    },
  });

  const expenseIds = entries.map((e) => e.relatedDocumentId);
  const expenses = await prisma.expense.findMany({ where: { id: { in: expenseIds } } });
  const categoryIds = [...new Set(expenses.map((e) => e.categoryId))];
  const categories = await prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } } });
  const labelById = new Map(categories.map((c) => [c.id, c.label]));
  const amountByExpenseId = new Map(entries.map((e) => [e.relatedDocumentId, e.amount]));

  const byCategory = new Map<string, Decimal>();
  for (const expense of expenses) {
    const amount = amountByExpenseId.get(expense.id) ?? expense.amount;
    byCategory.set(expense.categoryId, (byCategory.get(expense.categoryId) ?? new Decimal(0)).plus(amount));
  }

  const lines = [...byCategory.entries()].map(([categoryId, total]) => ({
    categoryId,
    label: labelById.get(categoryId) ?? "Uncategorized",
    total,
  }));
  lines.sort((a, b) => b.total.minus(a.total).toNumber());

  return { lines, total: sumDecimal(lines.map((l) => l.total)) };
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
