import { prisma } from "../../lib/prisma.js";
import { Decimal, assertEqual, sumDecimal } from "../../lib/money.js";

/**
 * Finance ledger posting — DEFAULT policy, not a final accounting decision.
 * Spec section 11 explicitly asks for accountant sign-off on posting
 * triggers (when revenue recognizes, tax/exchange-difference treatment,
 * closing policy) before this runs in production. What's implemented here:
 *
 *   - Revenue/COGS post at DISPATCH (not order confirmation, not delivery).
 *   - Only PKR-denominated orders/payments are posted automatically — a
 *     foreign-currency posting throws rather than guessing an FX/exchange-
 *     difference treatment, since that's exactly what spec section 9 says
 *     needs the accountant's input.
 *   - Transfers and owner contributions/withdrawals are excluded from the
 *     revenue/expense side by construction (they only ever move between
 *     two Accounts, never touch SALES_REVENUE/OPERATING_EXPENSES).
 *
 * Control accounts (ACCOUNTS_RECEIVABLE, INVENTORY, COGS, SALES_REVENUE,
 * SALES_RETURNS, SUPPLIER_ADVANCES, ACCOUNTS_PAYABLE, OWNERS_EQUITY,
 * BANK_CHARGES, OPERATING_EXPENSES) are seeded by `prisma/seed.ts`.
 */

interface LedgerEntryInput {
  accountId: string;
  direction: "debit" | "credit";
  amount: Decimal | number;
  currencyId: string;
}

async function controlAccount(code: string) {
  return prisma.account.findUniqueOrThrow({ where: { code } });
}

/** Posts a balanced set of entries (debits == credits, per currency) in one transaction. Never partially posts. */
export async function postBalanced(params: {
  entries: LedgerEntryInput[];
  relatedDocumentType: string;
  relatedDocumentId: string;
}) {
  const byCurrency = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const e of params.entries) {
    const amount = new Decimal(e.amount);
    const bucket = byCurrency.get(e.currencyId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    if (e.direction === "debit") bucket.debit = bucket.debit.plus(amount);
    else bucket.credit = bucket.credit.plus(amount);
    byCurrency.set(e.currencyId, bucket);
  }
  for (const [currencyId, bucket] of byCurrency) {
    assertEqual(bucket.debit, bucket.credit, `Unbalanced posting in currency ${currencyId}`);
  }

  return prisma.$transaction(
    params.entries.map((e) =>
      prisma.ledgerEntry.create({
        data: {
          accountId: e.accountId,
          direction: e.direction,
          amount: new Decimal(e.amount),
          currencyId: e.currencyId,
          relatedDocumentType: params.relatedDocumentType,
          relatedDocumentId: params.relatedDocumentId,
        },
      }),
    ),
  );
}

/** Balance = sum of amounts on the account's "increasing" side minus the "decreasing" side, per its nature. */
export async function getAccountBalance(accountId: string): Promise<Decimal> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const entries = await prisma.ledgerEntry.findMany({ where: { accountId } });
  const debits = sumDecimal(entries.filter((e) => e.direction === "debit").map((e) => e.amount));
  const credits = sumDecimal(entries.filter((e) => e.direction === "credit").map((e) => e.amount));

  const debitNormal = account.nature === "asset" || account.nature === "expense";
  return debitNormal ? debits.minus(credits) : credits.minus(debits);
}

function assertPkr(currencyId: string, pkrCurrencyId: string, context: string) {
  if (currencyId !== pkrCurrencyId) {
    throw new Error(
      `${context}: posting a non-PKR amount directly needs an accountant-approved FX treatment — not implemented`,
    );
  }
}

/** Dr Operating Expenses (or the bank account directly skips AP), Cr the paying account or Accounts Payable if unpaid. */
export async function postExpense(expenseId: string) {
  const expense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(expense.currencyId, pkr.id, "postExpense");

  const operatingExpenses = await controlAccount("OPERATING_EXPENSES");
  const creditAccountId =
    expense.paymentStatus === "paid" ? expense.accountId : (await controlAccount("ACCOUNTS_PAYABLE")).id;

  return postBalanced({
    relatedDocumentType: "Expense",
    relatedDocumentId: expense.id,
    entries: [
      { accountId: operatingExpenses.id, direction: "debit", amount: expense.amount, currencyId: pkr.id },
      { accountId: creditAccountId, direction: "credit", amount: expense.amount, currencyId: pkr.id },
    ],
  });
}

/** Dr Supplier Advances (prepaid asset), Cr the bank/cash account the payment left from. */
export async function postSupplierAdvance(advanceId: string) {
  const advance = await prisma.supplierAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(advance.currencyId, pkr.id, "postSupplierAdvance");

  const supplierAdvances = await controlAccount("SUPPLIER_ADVANCES");

  return postBalanced({
    relatedDocumentType: "SupplierAdvance",
    relatedDocumentId: advance.id,
    entries: [
      { accountId: supplierAdvances.id, direction: "debit", amount: advance.amount, currencyId: pkr.id },
      { accountId: advance.paymentMethodAccountId, direction: "credit", amount: advance.amount, currencyId: pkr.id },
    ],
  });
}

/** Dr the destination bank/cash account, Cr Accounts Receivable. */
export async function postCustomerReceipt(receiptId: string) {
  const receipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(receipt.currencyId, pkr.id, "postCustomerReceipt");

  const accountsReceivable = await controlAccount("ACCOUNTS_RECEIVABLE");

  return postBalanced({
    relatedDocumentType: "PaymentReceipt",
    relatedDocumentId: receipt.id,
    entries: [
      { accountId: receipt.destinationAccountId, direction: "debit", amount: receipt.amount, currencyId: pkr.id },
      { accountId: accountsReceivable.id, direction: "credit", amount: receipt.amount, currencyId: pkr.id },
    ],
  });
}

/** Dr Sales Returns, Cr the refunding bank/cash account (only once actually paid). */
export async function postRefund(refundId: string) {
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (refund.status !== "refunded" || !refund.paymentMethodAccountId) {
    throw new Error("Only a refund that has actually been paid can be posted");
  }
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(refund.currencyId, pkr.id, "postRefund");

  const salesReturns = await controlAccount("SALES_RETURNS");

  return postBalanced({
    relatedDocumentType: "Refund",
    relatedDocumentId: refund.id,
    entries: [
      { accountId: salesReturns.id, direction: "debit", amount: refund.amount, currencyId: pkr.id },
      { accountId: refund.paymentMethodAccountId, direction: "credit", amount: refund.amount, currencyId: pkr.id },
    ],
  });
}

/**
 * Posts revenue and COGS for one shipment line, at dispatch — the DEFAULT
 * recognition point (see module docstring). Revenue uses the order line's
 * bundle-allocated unit revenue if present, else its plain unitPrice; COGS
 * uses the actual cost layer the dispatched pieces came from (never the
 * product's latest purchase price — spec section 12).
 */
export async function postSaleDispatch(shipmentLineId: string) {
  const shipmentLine = await prisma.shipmentLine.findUniqueOrThrow({
    where: { id: shipmentLineId },
    include: {
      orderLine: { include: { order: true, bundleAllocation: true } },
      pickAllocation: { include: { costLayer: true } },
    },
  });
  if (!shipmentLine.pickAllocation) {
    throw new Error("Shipment line has no pick allocation to derive cost from");
  }

  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(shipmentLine.orderLine.order.currencyId, pkr.id, "postSaleDispatch (order currency)");

  const unitRevenue = shipmentLine.orderLine.bundleAllocation
    ? shipmentLine.orderLine.bundleAllocation.derivedUnitRevenue
    : shipmentLine.orderLine.unitPrice ?? new Decimal(0);
  const revenue = unitRevenue.times(shipmentLine.quantity);
  const cogs = shipmentLine.pickAllocation.costLayer.unitCost.times(shipmentLine.quantity);

  const accountsReceivable = await controlAccount("ACCOUNTS_RECEIVABLE");
  const salesRevenue = await controlAccount("SALES_REVENUE");
  const inventory = await controlAccount("INVENTORY");
  const costOfGoodsSold = await controlAccount("COGS");

  const entries: LedgerEntryInput[] = [
    { accountId: accountsReceivable.id, direction: "debit", amount: revenue, currencyId: pkr.id },
    { accountId: salesRevenue.id, direction: "credit", amount: revenue, currencyId: pkr.id },
  ];
  if (cogs.greaterThan(0)) {
    entries.push(
      { accountId: costOfGoodsSold.id, direction: "debit", amount: cogs, currencyId: pkr.id },
      { accountId: inventory.id, direction: "credit", amount: cogs, currencyId: pkr.id },
    );
  }

  return postBalanced({
    relatedDocumentType: "ShipmentLine",
    relatedDocumentId: shipmentLine.id,
    entries,
  });
}

export async function postTransfer(transferId: string) {
  const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  assertPkr(transfer.currencyId, pkr.id, "postTransfer");

  return postBalanced({
    relatedDocumentType: "Transfer",
    relatedDocumentId: transfer.id,
    entries: [
      { accountId: transfer.toAccountId, direction: "debit", amount: transfer.amount, currencyId: pkr.id },
      { accountId: transfer.fromAccountId, direction: "credit", amount: transfer.amount, currencyId: pkr.id },
    ],
  });
}

/** Excluded from trading P&L by construction — only ever touches a bank account and Owner's Equity. */
export async function postOwnerTransaction(ownerTransactionId: string) {
  const tx = await prisma.ownerTransaction.findUniqueOrThrow({ where: { id: ownerTransactionId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  const ownersEquity = await controlAccount("OWNERS_EQUITY");

  const isContribution = tx.type === "contribution";
  return postBalanced({
    relatedDocumentType: "OwnerTransaction",
    relatedDocumentId: tx.id,
    entries: isContribution
      ? [
          { accountId: tx.accountId, direction: "debit", amount: tx.amount, currencyId: pkr.id },
          { accountId: ownersEquity.id, direction: "credit", amount: tx.amount, currencyId: pkr.id },
        ]
      : [
          { accountId: ownersEquity.id, direction: "debit", amount: tx.amount, currencyId: pkr.id },
          { accountId: tx.accountId, direction: "credit", amount: tx.amount, currencyId: pkr.id },
        ],
  });
}
