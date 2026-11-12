import { prisma } from "../../lib/prisma.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";
import { lockExchangeRate } from "./currencyService.js";
import { postCustomerReceipt, postRefund } from "./ledgerService.js";
import { createRefund, markRefundPaid } from "../sales/refundService.js";
import { getOrderPaymentSummary, updateOrderStatus } from "../sales/salesOrderService.js";

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
}) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: params.orderId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const amount = new Decimal(params.amount);
  const before = await getOrderPaymentSummary(params.orderId);
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

  await postCustomerReceipt(receipt.id);

  const after = await getOrderPaymentSummary(params.orderId);
  const newPaymentStatus = after.outstanding.lessThanOrEqualTo(0)
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
}) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: params.orderId } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const refund = await createRefund({ orderId: order.id, amount: params.amount, currencyId: pkr.id });
  await markRefundPaid(refund.id, params.paymentMethodAccountId);
  await postRefund(refund.id);
  return refund;
}
