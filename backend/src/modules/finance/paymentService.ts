import { prisma } from "../../lib/prisma.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { lockExchangeRate, convertOrderAmountToPkr } from "./currencyService.js";
import { postCustomerReceipt, postRefund, postTransfer } from "./ledgerService.js";
import { createRefund, markRefundPaid } from "../sales/refundService.js";
import { getOrderPaymentSummary, updateOrderStatus, computeOrderCostSummary } from "../sales/salesOrderService.js";

interface AllocationInput {
  orderId: string;
  amount: Decimal | number;
}

/**
 * Records a customer receipt against one or more orders (spec section 9).
 * The receipt's exchangeRateSnapshotId is locked now and never changed —
 * this is the INDICATIVE rate for the receipt, which is deliberately kept
 * separate from whatever rate a later CurrencyConversion actually achieves.
 * Supports partial payments and many-to-many receipt<->order allocation.
 *
 * Rejects any allocation that would push an order's total received past its
 * net total — this was previously only checked in recordSalesOrderPayment's
 * wrapper, so this lower-level function (also reachable directly via
 * POST /finance/receipts, and by one-off scripts) had no protection against
 * exactly the double-payment this guard exists to prevent (confirmed in
 * production: two receipts totalling 20,000 against a 10,000 order).
 */
export async function recordCustomerReceipt(params: {
  customerId?: string;
  currencyId: string;
  amount: Decimal | number;
  receivedAt: Date;
  destinationAccountId: string;
  bankReference?: string;
  exchangeRateSnapshotId: string;
  allocations: AllocationInput[];
}) {
  const amount = new Decimal(params.amount);
  const allocationTotal = sumDecimal(params.allocations.map((a) => new Decimal(a.amount)));
  if (allocationTotal.greaterThan(amount)) {
    throw new Error("Allocations cannot exceed the received amount");
  }

  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  for (const alloc of params.allocations) {
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: alloc.orderId }, include: { lines: true } });
    const { netTotal } = computeOrderCostSummary(order);

    // The comparison must happen in ONE currency — the receipt's own. A
    // receipt in the order's own currency (e.g. a GBP receipt against a GBP
    // order — spec section 9's Fleek scenario) compares directly, no
    // conversion needed. A PKR receipt against a non-PKR order (the
    // one-step "record a sales order payment" popup always posts in PKR
    // regardless of the order's currency) needs the order's own-currency
    // netTotal converted to PKR first — comparing that PKR payment
    // directly against a raw foreign-currency netTotal was exactly the "no
    // FX conversion" bug. Any other combination (e.g. a USD receipt against
    // a GBP order) has no conversion path and is rejected rather than
    // silently comparing incompatible numbers.
    let netTotalInReceiptCurrency: Decimal | null;
    if (params.currencyId === order.currencyId) {
      netTotalInReceiptCurrency = netTotal;
    } else if (params.currencyId === pkr.id) {
      netTotalInReceiptCurrency = await convertOrderAmountToPkr({
        currencyId: order.currencyId,
        exchangeRateSnapshotId: order.exchangeRateSnapshotId,
        amount: netTotal,
        pkrCurrencyId: pkr.id,
      });
    } else {
      throw new Error(
        `Cannot record a receipt in a currency that is neither Order ${order.orderNumber}'s own currency nor PKR — no conversion path exists for that combination`,
      );
    }
    if (netTotalInReceiptCurrency === null) {
      throw new Error(
        `Order ${order.orderNumber} is in a non-PKR currency with no exchange rate locked — set one (PATCH /sales/orders/:id/exchange-rate) before recording a payment against it`,
      );
    }

    const existing = await prisma.paymentAllocation.findMany({ where: { orderId: alloc.orderId } });
    const alreadyReceived = sumDecimal(existing.map((a) => a.amount));
    const allocAmount = new Decimal(alloc.amount);
    const newTotal = alreadyReceived.plus(allocAmount);
    if (newTotal.greaterThan(netTotalInReceiptCurrency)) {
      throw new Error(
        `Order ${order.orderNumber} has already received ${alreadyReceived.toString()} of ${netTotalInReceiptCurrency.toString()} due — allocating ${allocAmount.toString()} more would overpay it by ${newTotal.minus(netTotalInReceiptCurrency).toString()}. Nothing was recorded.`,
      );
    }
  }

  return prisma.paymentReceipt.create({
    data: {
      customerId: params.customerId,
      currencyId: params.currencyId,
      amount,
      receivedAt: params.receivedAt,
      destinationAccountId: params.destinationAccountId,
      bankReference: params.bankReference,
      exchangeRateSnapshotId: params.exchangeRateSnapshotId,
      allocations: {
        create: params.allocations.map((a) => ({ orderId: a.orderId, amount: new Decimal(a.amount) })),
      },
    },
    include: { allocations: true },
  });
}

/**
 * The actual GBP (or other foreign currency) -> PKR conversion, recorded as
 * its own event with its own rate — never assumed to equal the receipt's
 * locked indicative rate (spec section 9: "actual conversion rate... and
 * any bank charges", "distinguish indicative order value from actual
 * settlement proceeds and exchange differences").
 */
export async function convertCurrency(params: {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: Decimal | number;
  toAmount: Decimal | number;
  rate: Decimal | number;
  bankCharges?: Decimal | number;
}) {
  const fromAmount = new Decimal(params.fromAmount);
  assertNonNegative(fromAmount, "fromAmount must not be negative");

  return prisma.currencyConversion.create({
    data: {
      fromAccountId: params.fromAccountId,
      toAccountId: params.toAccountId,
      fromAmount,
      toAmount: new Decimal(params.toAmount),
      rate: new Decimal(params.rate),
      bankCharges: params.bankCharges !== undefined ? new Decimal(params.bankCharges) : undefined,
    },
  });
}

/** Total received so far against one order, across all receipts/allocations. */
export async function totalReceivedForOrder(orderId: string): Promise<Decimal> {
  const allocations = await prisma.paymentAllocation.findMany({ where: { orderId } });
  return sumDecimal(allocations.map((a) => a.amount));
}

/**
 * One-step "record a sales order payment": creates the customer receipt,
 * posts it to the ledger, and syncs the order's paymentStatus label — all
 * in a single call, so recording a payment here never needs a second visit
 * to Customer Receipts. Only ever posts in PKR (same constraint as every
 * other ledger posting in this system); rejects an amount that would
 * overpay the order, which also rules out an accidental duplicate entry.
 */
export async function recordSalesOrderPayment(params: {
  orderId: string;
  amount: Decimal | number;
  receivedAt: Date;
  destinationAccountId: string;
  bankReference?: string;
  actorUserId: string;
}) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: params.orderId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const amount = new Decimal(params.amount);
  const before = await getOrderPaymentSummary(params.orderId);
  if (before.outstanding === null) {
    throw new Error(
      `Order ${order.orderNumber} is in a non-PKR currency with no exchange rate locked — set one (PATCH /sales/orders/:id/exchange-rate) before recording a payment against it`,
    );
  }
  if (amount.greaterThan(before.outstanding)) {
    throw new Error(
      `Amount ${amount.toString()} exceeds the outstanding balance of ${before.outstanding.toString()} — nothing was recorded.`,
    );
  }

  const rate = await lockExchangeRate({
    fromCurrencyId: pkr.id,
    toCurrencyId: pkr.id,
    rate: 1,
    source: "sales order payment popup",
  });

  const receipt = await recordCustomerReceipt({
    customerId: order.customerId,
    currencyId: pkr.id,
    amount,
    receivedAt: params.receivedAt,
    destinationAccountId: params.destinationAccountId,
    bankReference: params.bankReference,
    exchangeRateSnapshotId: rate.id,
    allocations: [{ orderId: params.orderId, amount }],
  });

  await postCustomerReceipt(receipt.id, params.actorUserId);

  const after = await getOrderPaymentSummary(params.orderId);
  // The exchange rate can't have changed between `before` and `after` (no
  // edit happened in between), so having passed the `before.outstanding ===
  // null` guard above means this is never null here too.
  const newPaymentStatus = after.outstanding!.lessThanOrEqualTo(0)
    ? "paid"
    : after.amountReceived.greaterThan(0)
      ? "partially_paid"
      : "unpaid";
  let order2 = order;
  if (newPaymentStatus !== order.paymentStatus) {
    order2 = await updateOrderStatus(params.orderId, { paymentStatus: newPaymentStatus });
  }

  return { receipt, paymentSummary: after, order: order2 };
}

/**
 * One-step "record a sales order refund": creates the Refund, marks it
 * paid from the chosen account, and posts it to the ledger (Dr Sales
 * Returns, Cr that account) — used by the quick "mark returned"/"cancel"
 * popups so an entered refund amount actually produces a real, posted
 * financial event instead of just a label. Deliberately does NOT attempt
 * to guess which lot/grade the returned pieces go back to — that stays a
 * manual, deliberate action via the detailed returns flow, since guessing
 * it here risks silently misstating stock.
 */
export async function recordSalesOrderRefund(params: {
  orderId: string;
  amount: Decimal | number;
  paymentMethodAccountId: string;
  actorUserId: string;
}) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: params.orderId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const refund = await createRefund({ orderId: order.id, amount: params.amount, currencyId: pkr.id });
  await markRefundPaid(refund.id, params.paymentMethodAccountId);
  await postRefund(refund.id, params.actorUserId);
  return refund;
}

/**
 * Moves money between two of the business's own accounts (e.g. cash into
 * the bank) and posts it immediately — a transfer must never touch
 * SALES_REVENUE/OPERATING_EXPENSES, only the two Accounts involved, so it
 * can never be miscategorized as a sale or an expense (spec section 7).
 * Only PKR for now, same constraint as every other ledger posting here.
 */
export async function recordTransfer(params: {
  fromAccountId: string;
  toAccountId: string;
  amount: Decimal | number;
  occurredAt?: Date;
  actorUserId: string;
}) {
  if (params.fromAccountId === params.toAccountId) {
    throw new Error("A transfer must move money between two different accounts");
  }
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const transfer = await prisma.transfer.create({
    data: {
      fromAccountId: params.fromAccountId,
      toAccountId: params.toAccountId,
      amount: new Decimal(params.amount),
      currencyId: pkr.id,
      occurredAt: params.occurredAt ?? new Date(),
    },
  });
  await postTransfer(transfer.id, params.actorUserId);
  return transfer;
}
