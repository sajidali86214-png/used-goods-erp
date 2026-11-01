import { prisma } from "../../lib/prisma.js";
import { Decimal, assertNonNegative, sumDecimal } from "../../lib/money.js";

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
