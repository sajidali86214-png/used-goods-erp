import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { enterBranchContext } from "../src/lib/branchContext.js";
import { refreshAllExchangeRates } from "../src/modules/finance/exchangeRateRefreshService.js";

const MAIN_BRANCH_ID = "00000000-0000-0000-0000-000000000001";

afterAll(async () => {
  await prisma.$disconnect();
});

// Hits the real open.er-api.com API — no mocks, matching this repo's
// real-everything testing style (same risk profile as drive-backup.test.ts,
// which also depends on a real external service).
describe("automatic daily exchange rate refresh", () => {
  it("fetches a real GBP->PKR rate and locks it as the new latest snapshot for every active branch", async () => {
    const gbp = await prisma.currency.upsert({ where: { code: "GBP" }, update: {}, create: { code: "GBP", symbol: "£" } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

    const results = await refreshAllExchangeRates();
    expect(results.length).toBeGreaterThan(0);

    const mainResult = results.find((r) => r.branchCode === "MAIN" && r.currencyCode === "GBP");
    expect(mainResult).toBeDefined();
    expect(mainResult!.error).toBeUndefined();
    expect(mainResult!.rate).toBeGreaterThan(0); // a real market rate, not a placeholder

    enterBranchContext({ branchId: MAIN_BRANCH_ID });
    const latest = await prisma.exchangeRateSnapshot.findFirst({
      where: { fromCurrencyId: gbp.id, toCurrencyId: pkr.id },
      orderBy: { capturedAt: "desc" },
    });
    expect(latest).toBeDefined();
    expect(latest!.source).toBe("open.er-api.com (automatic daily refresh)");
    expect(latest!.isManualOverride).toBe(false);
    expect(latest!.rate.toNumber()).toBe(mainResult!.rate);
  }, 20000);
});
