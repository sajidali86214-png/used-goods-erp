import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

/**
 * Locks an exchange rate snapshot. Snapshots are append-only — "refreshing"
 * the rate always creates a NEW row; a posted document's reference to an
 * old snapshot id is never rewritten, so historical results never move when
 * rates refresh later (spec section 9, acceptance test #13).
 */
export async function lockExchangeRate(params: {
  fromCurrencyId: string;
  toCurrencyId: string;
  rate: Decimal | number;
  source: string;
  isManualOverride?: boolean;
  overrideReason?: string;
  overrideByUserId?: string;
}) {
  if (params.isManualOverride && !params.overrideReason) {
    throw new Error("overrideReason is required when isManualOverride is true");
  }
  return prisma.exchangeRateSnapshot.create({
    data: {
      fromCurrencyId: params.fromCurrencyId,
      toCurrencyId: params.toCurrencyId,
      rate: new Decimal(params.rate),
      source: params.source,
      isManualOverride: params.isManualOverride ?? false,
      overrideReason: params.overrideReason,
      overrideByUserId: params.overrideByUserId,
    },
  });
}

export async function latestRate(fromCurrencyId: string, toCurrencyId: string) {
  return prisma.exchangeRateSnapshot.findFirst({
    where: { fromCurrencyId, toCurrencyId },
    orderBy: { capturedAt: "desc" },
  });
}

/**
 * Converts a sales order amount (in the order's own currency) to PKR using
 * its own locked exchangeRateSnapshotId — never the currency's current
 * "latest" rate, since that would move a historical order's PKR value every
 * time a new rate is captured (same append-only-snapshot principle as
 * lockExchangeRate's docstring).
 *
 * Returns null, rather than guessing, when conversion isn't possible: a
 * non-PKR order with no rate locked yet (a pre-this-fix legacy order, or a
 * still-unconfirmed draft nobody has set a rate on). Callers must treat
 * null as "exclude this order from any PKR total, don't add its raw
 * foreign-currency number as if it were already PKR" — that silent mixing
 * is exactly the bug this function exists to prevent.
 */
export async function convertOrderAmountToPkr(params: {
  currencyId: string;
  exchangeRateSnapshotId: string | null;
  amount: Decimal;
  pkrCurrencyId: string;
}): Promise<Decimal | null> {
  if (params.currencyId === params.pkrCurrencyId) return params.amount;
  if (!params.exchangeRateSnapshotId) return null;
  const snapshot = await prisma.exchangeRateSnapshot.findUnique({ where: { id: params.exchangeRateSnapshotId } });
  if (!snapshot) return null;
  return params.amount.times(snapshot.rate);
}
