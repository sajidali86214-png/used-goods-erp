import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { Decimal, assertEqual, sumDecimal } from "../../lib/money.js";
import { assertPeriodNotLocked } from "./periodLockService.js";
import { runSerializable } from "../../lib/transaction.js";

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
 *
 * Every exported post* function below runs its ENTIRE body — fetching the
 * source document, deriving entries, and writing them — inside one
 * `runSerializable` transaction (consistently via the injected `tx`, never a
 * bare `prisma.*` call for business data). Previously only postBalanced's own
 * tail end was transactional; the reads that gathered each posting's amounts
 * ran outside any transaction, so a posting wasn't guaranteed to see a
 * consistent snapshot or roll back together with whatever triggered it.
 */

interface LedgerEntryInput {
  accountId: string;
  direction: "debit" | "credit";
  amount: Decimal | number;
  currencyId: string;
  // Set when this entry reverses a specific prior entry (e.g. undoing a
  // GRN's Dr Inventory / Cr GRNI when the receipt is reversed) — first real
  // use of this schema field. Omitted for an ordinary (non-reversing) entry.
  reversalOfId?: string;
}

/** Exported so other modules (stockService.ts, grnCorrectionService.ts) can post within their OWN transaction, same pattern used throughout this file. */
export async function controlAccount(tx: Prisma.TransactionClient, code: string) {
  // findFirst, not findUnique: Account.code is now a (branchId, code)
  // composite unique, so this plain filter stays correct with the
  // branch-scoping extension merging branchId in automatically.
  return tx.account.findFirstOrThrow({ where: { code } });
}

export async function pkrCurrency(tx: Prisma.TransactionClient) {
  return tx.currency.findUniqueOrThrow({ where: { code: "PKR" } });
}

function assertPkr(currencyId: string, pkrCurrencyId: string, context: string) {
  if (currencyId !== pkrCurrencyId) {
    throw new Error(
      `${context}: posting a non-PKR amount directly needs an accountant-approved FX treatment — not implemented`,
    );
  }
}

/**
 * Posts a balanced set of entries (debits == credits, per currency) using the
 * caller's own transaction. Never partially posts. `postedAt` defaults to
 * now; backdating it is a caller decision gated by the `backdate.create`
 * permission at the route layer (spec section 13) — this function only
 * enforces that the target date isn't inside an already-locked, non-reopened
 * period (spec section 11/13).
 */
export async function postBalancedWithin(
  tx: Prisma.TransactionClient,
  params: {
    entries: LedgerEntryInput[];
    relatedDocumentType: string;
    relatedDocumentId: string;
    actorUserId: string;
    postedAt?: Date;
  },
) {
  const postedAt = params.postedAt ?? new Date();
  await assertPeriodNotLocked(postedAt);

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

  // Every post* function funnels through here, so this is the one place to
  // guard against the same document being posted twice — a stale UI call, a
  // retried request, or a leftover manual "post" route being hit after
  // something already auto-posted would otherwise silently double every
  // ledger entry with no error. Checked and inserted inside the same
  // SERIALIZABLE transaction so two concurrent calls for the same document
  // can't both pass the check before either commits (runSerializable retries
  // the loser, not silently proceeds).
  const alreadyPosted = await tx.ledgerEntry.findFirst({
    where: { relatedDocumentType: params.relatedDocumentType, relatedDocumentId: params.relatedDocumentId },
  });
  if (alreadyPosted) {
    throw new Error(`${params.relatedDocumentType} ${params.relatedDocumentId} has already been posted to the ledger`);
  }

  const created = await Promise.all(
    params.entries.map((e) =>
      tx.ledgerEntry.create({
        data: {
          accountId: e.accountId,
          direction: e.direction,
          amount: new Decimal(e.amount),
          currencyId: e.currencyId,
          postedAt,
          relatedDocumentType: params.relatedDocumentType,
          relatedDocumentId: params.relatedDocumentId,
          reversalOfId: e.reversalOfId,
        },
      }),
    ),
  );

  // Every ledger posting writes its own audit event — previously none did,
  // making the most money-sensitive code in the system the least audited.
  await tx.auditEvent.create({
    data: {
      entityType: params.relatedDocumentType,
      entityId: params.relatedDocumentId,
      action: "post_ledger_entries",
      actorUserId: params.actorUserId,
      afterJson: {
        entries: params.entries.map((e) => ({
          accountId: e.accountId,
          direction: e.direction,
          amount: new Decimal(e.amount).toString(),
          currencyId: e.currencyId,
        })),
      },
    },
  });

  return created;
}

/** Exported standalone entry point — opens its own transaction. Kept for any external caller that posts without its own surrounding transaction. */
export async function postBalanced(params: Parameters<typeof postBalancedWithin>[1]) {
  return runSerializable((tx) => postBalancedWithin(tx, params));
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

/** Dr Operating Expenses (or the bank account directly skips AP), Cr the paying account or Accounts Payable if unpaid. */
export async function postExpense(expenseId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(expense.currencyId, pkr.id, "postExpense");

    const operatingExpenses = await controlAccount(tx, "OPERATING_EXPENSES");
    const creditAccountId =
      expense.paymentStatus === "paid" ? expense.accountId : (await controlAccount(tx, "ACCOUNTS_PAYABLE")).id;

    return postBalancedWithin(tx, {
      relatedDocumentType: "Expense",
      relatedDocumentId: expense.id,
      actorUserId,
      entries: [
        { accountId: operatingExpenses.id, direction: "debit", amount: expense.amount, currencyId: pkr.id },
        { accountId: creditAccountId, direction: "credit", amount: expense.amount, currencyId: pkr.id },
      ],
    });
  });
}

/**
 * Settles a previously-unpaid expense: Dr Accounts Payable (what's owed
 * goes down), Cr the account the money actually left from. Posted as its
 * own document (relatedDocumentId is the expense id with a "-settlement"
 * suffix, since the original Expense id is already used by postExpense's
 * own posting and postBalanced refuses to post the same document twice).
 * Flips the Expense's own paymentStatus to "paid" so it stops showing as
 * outstanding, and records which account actually paid it.
 */
export async function settleExpensePayment(expenseId: string, payingAccountId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
    if (expense.paymentStatus !== "unpaid") {
      throw new Error("Only an unpaid expense can be settled");
    }
    const pkr = await pkrCurrency(tx);
    assertPkr(expense.currencyId, pkr.id, "settleExpensePayment");

    const accountsPayable = await controlAccount(tx, "ACCOUNTS_PAYABLE");
    await postBalancedWithin(tx, {
      relatedDocumentType: "Expense",
      relatedDocumentId: `${expense.id}-settlement`,
      actorUserId,
      entries: [
        { accountId: accountsPayable.id, direction: "debit", amount: expense.amount, currencyId: pkr.id },
        { accountId: payingAccountId, direction: "credit", amount: expense.amount, currencyId: pkr.id },
      ],
    });

    return tx.expense.update({ where: { id: expense.id }, data: { paymentStatus: "paid", accountId: payingAccountId } });
  });
}

/** Dr Supplier Advances (prepaid asset), Cr the bank/cash account the payment left from. */
export async function postSupplierAdvance(advanceId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const advance = await tx.supplierAdvance.findUniqueOrThrow({ where: { id: advanceId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(advance.currencyId, pkr.id, "postSupplierAdvance");

    const supplierAdvances = await controlAccount(tx, "SUPPLIER_ADVANCES");

    return postBalancedWithin(tx, {
      relatedDocumentType: "SupplierAdvance",
      relatedDocumentId: advance.id,
      actorUserId,
      entries: [
        { accountId: supplierAdvances.id, direction: "debit", amount: advance.amount, currencyId: pkr.id },
        { accountId: advance.paymentMethodAccountId, direction: "credit", amount: advance.amount, currencyId: pkr.id },
      ],
    });
  });
}

/**
 * Dr the receiving account (money/credit comes back to us), Cr Supplier
 * Advances — a credit reduces the same "what we're effectively owed back"
 * balance a real advance increases, so it shows up correctly in
 * getSupplierBalances' unappliedAdvance without a separate control account.
 */
export async function postSupplierCredit(creditId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const credit = await tx.supplierCredit.findUniqueOrThrow({ where: { id: creditId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(credit.currencyId, pkr.id, "postSupplierCredit");

    const supplierAdvances = await controlAccount(tx, "SUPPLIER_ADVANCES");

    return postBalancedWithin(tx, {
      relatedDocumentType: "SupplierCredit",
      relatedDocumentId: credit.id,
      actorUserId,
      entries: [
        { accountId: credit.receivingAccountId, direction: "debit", amount: credit.amount, currencyId: pkr.id },
        { accountId: supplierAdvances.id, direction: "credit", amount: credit.amount, currencyId: pkr.id },
      ],
    });
  });
}

/**
 * Approving a supplier invoice converts the receipt-time GRNI liability
 * into a real, supplier-owed Accounts Payable liability: Dr GRNI (clears
 * the clearing account) / Cr Accounts Payable (what we now actually owe).
 * Called by supplierInvoiceService.ts's `approveSupplierInvoice`, which
 * handles the approvalStatus guard and disputed-invoice check first.
 */
export async function postSupplierInvoiceApproval(invoiceId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const invoice = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(invoice.currencyId, pkr.id, "postSupplierInvoiceApproval");

    const grni = await controlAccount(tx, "GRNI");
    const accountsPayable = await controlAccount(tx, "ACCOUNTS_PAYABLE");

    return postBalancedWithin(tx, {
      relatedDocumentType: "SupplierInvoice",
      relatedDocumentId: invoice.id,
      actorUserId,
      entries: [
        { accountId: grni.id, direction: "debit", amount: invoice.amount, currencyId: pkr.id },
        { accountId: accountsPayable.id, direction: "credit", amount: invoice.amount, currencyId: pkr.id },
      ],
    });
  });
}

/** Dr the destination bank/cash account, Cr Accounts Receivable. */
export async function postCustomerReceipt(receiptId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const receipt = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(receipt.currencyId, pkr.id, "postCustomerReceipt");

    const accountsReceivable = await controlAccount(tx, "ACCOUNTS_RECEIVABLE");

    return postBalancedWithin(tx, {
      relatedDocumentType: "PaymentReceipt",
      relatedDocumentId: receipt.id,
      actorUserId,
      entries: [
        { accountId: receipt.destinationAccountId, direction: "debit", amount: receipt.amount, currencyId: pkr.id },
        { accountId: accountsReceivable.id, direction: "credit", amount: receipt.amount, currencyId: pkr.id },
      ],
    });
  });
}

/** Dr Sales Returns, Cr the refunding bank/cash account (only once actually paid). */
export async function postRefund(refundId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.status !== "refunded" || !refund.paymentMethodAccountId) {
      throw new Error("Only a refund that has actually been paid can be posted");
    }
    const pkr = await pkrCurrency(tx);
    assertPkr(refund.currencyId, pkr.id, "postRefund");

    const salesReturns = await controlAccount(tx, "SALES_RETURNS");

    return postBalancedWithin(tx, {
      relatedDocumentType: "Refund",
      relatedDocumentId: refund.id,
      actorUserId,
      entries: [
        { accountId: salesReturns.id, direction: "debit", amount: refund.amount, currencyId: pkr.id },
        { accountId: refund.paymentMethodAccountId, direction: "credit", amount: refund.amount, currencyId: pkr.id },
      ],
    });
  });
}

/**
 * Resolves a sales order's own-currency amount into PKR for ledger posting.
 * A PKR order needs no rate (1:1). A non-PKR order MUST have a rate locked
 * on it (SalesOrder.exchangeRateSnapshotId, set at order creation or via
 * PATCH /sales/orders/:id/exchange-rate) — this throws rather than falling
 * back to treating the raw foreign-currency number as PKR, which is exactly
 * the bug this replaces (confirmed in production: a delivered, paid GBP
 * order posted zero ledger entries because the old assertPkr check threw
 * and the caller silently swallowed it).
 */
async function resolveOrderPkrRate(
  tx: Prisma.TransactionClient,
  order: { id: string; orderNumber: string; currencyId: string; exchangeRateSnapshotId: string | null },
  pkrCurrencyId: string,
): Promise<Decimal> {
  if (order.currencyId === pkrCurrencyId) return new Decimal(1);
  if (!order.exchangeRateSnapshotId) {
    throw new Error(
      `Order ${order.orderNumber} is in a non-PKR currency with no exchange rate locked — set one (PATCH /sales/orders/:id/exchange-rate) before dispatching`,
    );
  }
  const snapshot = await tx.exchangeRateSnapshot.findUniqueOrThrow({ where: { id: order.exchangeRateSnapshotId } });
  return snapshot.rate;
}

/**
 * Posts revenue and COGS for one shipment line, at dispatch — the DEFAULT
 * recognition point (see module docstring). Revenue uses the order line's
 * bundle-allocated unit revenue if present, else its plain unitPrice,
 * converted to PKR at the order's own locked exchange rate; COGS uses the
 * actual cost layer the dispatched pieces came from (never the product's
 * latest purchase price — spec section 12), already PKR since purchasing
 * costs everything in PKR regardless of a sale's currency.
 */
export async function postSaleDispatch(shipmentLineId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const shipmentLine = await tx.shipmentLine.findUniqueOrThrow({
      where: { id: shipmentLineId },
      include: {
        orderLine: { include: { order: true, bundleAllocation: true } },
        pickAllocation: { include: { costLayer: true } },
      },
    });
    if (!shipmentLine.pickAllocation) {
      throw new Error("Shipment line has no pick allocation to derive cost from");
    }

    const pkr = await pkrCurrency(tx);
    const rate = await resolveOrderPkrRate(tx, shipmentLine.orderLine.order, pkr.id);

    const unitRevenue = shipmentLine.orderLine.bundleAllocation
      ? shipmentLine.orderLine.bundleAllocation.derivedUnitRevenue
      : shipmentLine.orderLine.unitPrice ?? new Decimal(0);
    const revenue = unitRevenue.times(shipmentLine.quantity).times(rate);
    const cogs = shipmentLine.pickAllocation.costLayer.unitCost.times(shipmentLine.quantity);

    const accountsReceivable = await controlAccount(tx, "ACCOUNTS_RECEIVABLE");
    const salesRevenue = await controlAccount(tx, "SALES_REVENUE");
    const inventory = await controlAccount(tx, "INVENTORY");
    const costOfGoodsSold = await controlAccount(tx, "COGS");

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

    return postBalancedWithin(tx, {
      relatedDocumentType: "ShipmentLine",
      relatedDocumentId: shipmentLine.id,
      actorUserId,
      entries,
    });
  });
}

export async function postTransfer(transferId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const transfer = await tx.transfer.findUniqueOrThrow({ where: { id: transferId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(transfer.currencyId, pkr.id, "postTransfer");

    return postBalancedWithin(tx, {
      relatedDocumentType: "Transfer",
      relatedDocumentId: transfer.id,
      actorUserId,
      entries: [
        { accountId: transfer.toAccountId, direction: "debit", amount: transfer.amount, currencyId: pkr.id },
        { accountId: transfer.fromAccountId, direction: "credit", amount: transfer.amount, currencyId: pkr.id },
      ],
    });
  });
}

/**
 * Excluded from trading P&L by construction — only ever touches a bank
 * account and Owner's Equity. Also how an account's opening balance gets
 * recorded (a "contribution" dated at go-live): the account didn't earn
 * that money through trading, so it has to enter the books some way other
 * than revenue, and crediting Owner's Equity is the standard treatment.
 */
export async function postOwnerTransaction(ownerTransactionId: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const ownerTx = await tx.ownerTransaction.findUniqueOrThrow({ where: { id: ownerTransactionId } });
    const account = await tx.account.findUniqueOrThrow({ where: { id: ownerTx.accountId } });
    const pkr = await pkrCurrency(tx);
    assertPkr(account.currencyId, pkr.id, "postOwnerTransaction");
    const ownersEquity = await controlAccount(tx, "OWNERS_EQUITY");

    const isContribution = ownerTx.type === "contribution";
    return postBalancedWithin(tx, {
      relatedDocumentType: "OwnerTransaction",
      relatedDocumentId: ownerTx.id,
      actorUserId,
      entries: isContribution
        ? [
            { accountId: ownerTx.accountId, direction: "debit", amount: ownerTx.amount, currencyId: pkr.id },
            { accountId: ownersEquity.id, direction: "credit", amount: ownerTx.amount, currencyId: pkr.id },
          ]
        : [
            { accountId: ownersEquity.id, direction: "debit", amount: ownerTx.amount, currencyId: pkr.id },
            { accountId: ownerTx.accountId, direction: "credit", amount: ownerTx.amount, currencyId: pkr.id },
          ],
    });
  });
}
