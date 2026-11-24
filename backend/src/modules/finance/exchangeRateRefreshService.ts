import { rawPrisma } from "../../lib/prisma.js";
import { enterBranchContext } from "../../lib/branchContext.js";
import { lockExchangeRate } from "./currencyService.js";

interface OpenErApiResponse {
  result: string;
  rates: Record<string, number>;
}

/**
 * Free, keyless, no-rate-limit public API (open.er-api.com) — updates once
 * every 24h, which is also the Vercel Hobby cron plan's own floor, so a
 * daily refresh here is already as fresh as this setup can usefully be.
 * Thrown error messages are caller-facing (logged in the refresh summary),
 * not surfaced to any end user.
 */
async function fetchRateToPkr(fromCurrencyCode: string): Promise<number> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${fromCurrencyCode}`);
  if (!res.ok) {
    throw new Error(`open.er-api.com responded ${res.status} for ${fromCurrencyCode}`);
  }
  const data = (await res.json()) as OpenErApiResponse;
  if (data.result !== "success") {
    throw new Error(`open.er-api.com returned result="${data.result}" for ${fromCurrencyCode}`);
  }
  const rate = data.rates["PKR"];
  if (rate === undefined) {
    throw new Error(`open.er-api.com response for ${fromCurrencyCode} has no PKR rate`);
  }
  return rate;
}

/**
 * Refreshes the PKR rate for every active non-PKR currency, for every active
 * branch (ExchangeRateSnapshot is branch-scoped, same as everything else
 * since the multi-branch work — a rate itself isn't branch-specific, but
 * each branch needs its own "latest" row for order creation to auto-fill
 * from). Never touches an order already locked to an old snapshot — this
 * only adds a new one for future orders to pick up, same append-only
 * principle as a manual rate lock.
 *
 * Partial failure (one currency's fetch fails) doesn't abort the rest —
 * each attempt is independent and reported in the results array, so a
 * transient outage for one pair doesn't block refreshing the others.
 */
export async function refreshAllExchangeRates() {
  const [branches, currencies, pkr] = await Promise.all([
    rawPrisma.branch.findMany({ where: { isActive: true } }),
    rawPrisma.currency.findMany({ where: { isActive: true, code: { not: "PKR" } } }),
    rawPrisma.currency.findUniqueOrThrow({ where: { code: "PKR" } }),
  ]);

  const results: { branchCode: string; currencyCode: string; rate?: number; error?: string }[] = [];

  // Fetched once per currency (the rate itself doesn't depend on branch) —
  // only the resulting ExchangeRateSnapshot row is created per branch, since
  // that's what's branch-scoped.
  const rateByCurrencyId = new Map<string, number>();
  const fetchErrorByCurrencyCode = new Map<string, string>();
  for (const currency of currencies) {
    try {
      rateByCurrencyId.set(currency.id, await fetchRateToPkr(currency.code));
    } catch (err) {
      fetchErrorByCurrencyCode.set(currency.code, err instanceof Error ? err.message : String(err));
    }
  }

  for (const branch of branches) {
    enterBranchContext({ branchId: branch.id });
    for (const currency of currencies) {
      const rate = rateByCurrencyId.get(currency.id);
      if (rate === undefined) {
        results.push({ branchCode: branch.code, currencyCode: currency.code, error: fetchErrorByCurrencyCode.get(currency.code) });
        continue;
      }
      try {
        await lockExchangeRate({
          fromCurrencyId: currency.id,
          toCurrencyId: pkr.id,
          rate,
          source: "open.er-api.com (automatic daily refresh)",
        });
        results.push({ branchCode: branch.code, currencyCode: currency.code, rate });
      } catch (err) {
        results.push({ branchCode: branch.code, currencyCode: currency.code, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return results;
}
