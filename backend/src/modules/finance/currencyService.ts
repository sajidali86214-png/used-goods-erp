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
