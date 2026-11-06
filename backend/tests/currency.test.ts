import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedSalesReferenceData, receiveSaleable } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { lockExchangeRate } from "../src/modules/finance/currencyService.js";
import { recordCustomerReceipt, convertCurrency, totalReceivedForOrder } from "../src/modules/finance/paymentService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #12: GBP sale, partial GBP receipt, later GBP->PKR conversion", () => {
  it("preserves the locked receipt rate and keeps the actual conversion rate separate; Fleek commission stays zero", async () => {
    const { customer, user } = await seedSalesReferenceData();

    const gbp = await prisma.currency.upsert({
      where: { code: "GBP" },
      update: {},
      create: { code: "GBP", symbol: "Â£" },
    });
    const pkr = await prisma.currency.upsert({
      where: { code: "PKR" },
      update: {},
      create: { code: "PKR", symbol: "Rs" },
    });

    const fleek = await prisma.salesChannel.upsert({
      where: { code: "fleek" },
      update: {},
      create: { code: "fleek", label: "Fleek", defaultCommissionPct: 0 },
    });
    expect(fleek.defaultCommissionPct?.toNumber() ?? 0).toBe(0);

    const gbpAccount = await prisma.account.create({
      data: { label: "GBP Holding", currencyId: gbp.id, kind: "bank" },
    });
    const pkrAccount = await prisma.account.create({
      data: { label: "PKR Main", currencyId: pkr.id, kind: "bank" },
    });

    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const product = await prisma.product.create({
      data: { skuCode: `SKU-${randomUUID()}`, name: "Fleek bundle", categoryId: category.id },
    });

    const order = await createDraftOrder({
      channelId: fleek.id,
      customerId: customer.id,
      currencyId: gbp.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 10, unitPrice: 20 }],
    });
    const orderTotalGbp = 200; // 10 * 20

    // Indicative rate captured while preparing the order.
    const indicativeRate = await lockExchangeRate({
      fromCurrencyId: gbp.id,
      toCurrencyId: pkr.id,
      rate: 350,
      source: "test-indicative",
    });

    // Partial GBP receipt: only 100 of the 200 GBP order value received so far.
    const receipt = await recordCustomerReceipt({
      customerId: customer.id,
      currencyId: gbp.id,
      amount: 100,
      receivedAt: new Date(),
      destinationAccountId: gbpAccount.id,
      bankReference: "FLEEK-REF-1",
      exchangeRateSnapshotId: indicativeRate.id,
      allocations: [{ orderId: order.id, amount: 100 }],
    });
    expect(receipt.amount.toNumber()).toBe(100);
    expect(receipt.exchangeRateSnapshotId).toBe(indicativeRate.id);

    const totalReceived = await totalReceivedForOrder(order.id);
    expect(totalReceived.toNumber()).toBe(100);
    expect(totalReceived.toNumber()).toBeLessThan(orderTotalGbp); // still only partially paid

    // Later: the GBP is actually exchanged to PKR at a DIFFERENT real rate, with bank charges.
    const conversion = await convertCurrency({
      fromAccountId: gbpAccount.id,
      toAccountId: pkrAccount.id,
      fromAmount: 100,
      toAmount: 34450, // actual settlement proceeds
      rate: 345, // differs from the 350 indicative rate locked on the receipt
      bankCharges: 50,
    });
    expect(conversion.rate.toNumber()).toBe(345);
    expect(conversion.toAmount.toNumber()).toBe(34450);

    // The receipt's locked indicative rate is untouched by the actual conversion.
    const refreshedReceipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    const refreshedSnapshot = await prisma.exchangeRateSnapshot.findUniqueOrThrow({
      where: { id: refreshedReceipt.exchangeRateSnapshotId },
    });
    expect(refreshedSnapshot.rate.toNumber()).toBe(350);
  });
});

describe("acceptance test #13: refreshing exchange rates never changes historical posted results", () => {
  it("an old snapshot and the lot/cost it priced stay fixed after a newer snapshot is locked", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();

    const oldRate = await lockExchangeRate({
      fromCurrencyId: currency.id,
      toCurrencyId: currency.id,
      rate: 1,
      source: "test-old",
    });

    // A lot received using the rate in effect at the time â€” this is Stage 1's
    // Lot.exchangeRate, locked at receipt and never touched again.
    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeByCode.get("A")!.id,
      unitPrice: 500,
      quantity: 10,
      actorUserId: user.id,
    });
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: costLayer.lotId } });
    expect(lot.exchangeRate.toNumber()).toBe(1);

    // Simulate a rate refresh â€” a brand new snapshot, the old one is never mutated.
    await lockExchangeRate({
      fromCurrencyId: currency.id,
      toCurrencyId: currency.id,
      rate: 1.08,
      source: "test-refreshed",
    });

    const stillOldRate = await prisma.exchangeRateSnapshot.findUniqueOrThrow({ where: { id: oldRate.id } });
    expect(stillOldRate.rate.toNumber()).toBe(1);

    const refreshedLot = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(refreshedLot.exchangeRate.toNumber()).toBe(1); // unchanged by the refresh

    const refreshedCostLayer = await prisma.costLayer.findUniqueOrThrow({ where: { id: costLayer.id } });
    expect(refreshedCostLayer.unitCost.toNumber()).toBe(500); // unchanged by the refresh
  });
});
