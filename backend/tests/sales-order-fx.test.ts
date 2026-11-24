import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder, getOrderPaymentSummary, setOrderExchangeRate } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { dispatchPickAllocation } from "../src/modules/sales/dispatchService.js";
import { postSaleDispatch, getAccountBalance } from "../src/modules/finance/ledgerService.js";
import { recordCustomerReceipt } from "../src/modules/finance/paymentService.js";
import { lockExchangeRate } from "../src/modules/finance/currencyService.js";
import { getCustomerBalances } from "../src/modules/reports/reportService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

async function gbpCurrency() {
  return prisma.currency.upsert({ where: { code: "GBP" }, update: {}, create: { code: "GBP", symbol: "£" } });
}

describe("sales orders in a non-PKR currency convert to PKR for the ledger/dashboard, never added raw", () => {
  it("dispatching a GBP order with a locked rate posts PKR-converted revenue (never the raw GBP number)", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } = await seedSalesReferenceData();
    const gbp = await gbpCurrency();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 200, quantity: 10, actorUserId: user.id });

    const rate = await lockExchangeRate({ fromCurrencyId: gbp.id, toCurrencyId: currency.id, rate: 375, source: "test-fx-dispatch" });
    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      exchangeRateSnapshotId: rate.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 10, unitPrice: 35 }], // £35/unit, £350 total
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 10 });
    const candidate = candidates[0]!;
    await reserveStock({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity });
    const pick = await pickFromReservation({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity, pickerUserId: user.id });

    const salesRevenue = await prisma.account.findFirstOrThrow({ where: { code: "SALES_REVENUE" } });
    const revenueBefore = await getAccountBalance(salesRevenue.id);

    const { shipmentLine } = await dispatchPickAllocation({ pickAllocationId: pick.id, quantity: 10, actorUserId: user.id });
    await postSaleDispatch(shipmentLine.id, user.id);

    const revenueAfter = await getAccountBalance(salesRevenue.id);
    // £350 * 375 = 131,250 PKR — never the raw 350.
    expect(revenueAfter.minus(revenueBefore).toNumber()).toBe(131250);
  });

  it("dispatching a non-PKR order with no exchange rate locked throws a clear, actionable error instead of silently posting nothing", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } = await seedSalesReferenceData();
    const gbp = await gbpCurrency();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 200, quantity: 5, actorUserId: user.id });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      // No exchangeRateSnapshotId — the legacy/unset case.
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 5, unitPrice: 35 }],
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 5 });
    const candidate = candidates[0]!;
    await reserveStock({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity });
    const pick = await pickFromReservation({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity, pickerUserId: user.id });
    const { shipmentLine } = await dispatchPickAllocation({ pickAllocationId: pick.id, quantity: 5, actorUserId: user.id });

    await expect(postSaleDispatch(shipmentLine.id, user.id)).rejects.toThrow(/no exchange rate locked/);
  });

  it("getOrderPaymentSummary flags needsExchangeRate instead of treating the raw foreign total as PKR", async () => {
    const { user, channel, customer } = await seedSalesReferenceData();
    const product = await prisma.product.create({
      data: { skuCode: `SKU-${randomUUID()}`, name: "P", categoryId: (await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } })).id },
    });
    const gbp = await gbpCurrency();

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 2, unitPrice: 50 }], // £100 total
    });

    const before = await getOrderPaymentSummary(order.id);
    expect(before.needsExchangeRate).toBe(true);
    expect(before.amountDue).toBeNull();
    expect(before.outstanding).toBeNull();
    expect(before.nativeAmountDue.toNumber()).toBe(100); // still shows the native-currency total

    const rate = await lockExchangeRate({ fromCurrencyId: gbp.id, toCurrencyId: (await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } })).id, rate: 400, source: "test" });
    await setOrderExchangeRate(order.id, rate.id);

    const after = await getOrderPaymentSummary(order.id);
    expect(after.needsExchangeRate).toBe(false);
    expect(after.amountDue!.toNumber()).toBe(40000); // 100 * 400
  });

  it("getCustomerBalances converts each order's own currency to PKR before summing — never mixes currencies", async () => {
    const { user, channel } = await seedSalesReferenceData();
    const customer = await prisma.customer.create({ data: { name: `FX-Balance-Customer-${randomUUID()}` } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const gbp = await gbpCurrency();
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const product = await prisma.product.create({ data: { skuCode: `SKU-${randomUUID()}`, name: "P", categoryId: category.id } });

    // PKR order: 1000 PKR, no conversion needed.
    await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: pkr.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 1000 }],
    });

    // GBP order with a locked rate: £50 * 380 = 19,000 PKR.
    const rate = await lockExchangeRate({ fromCurrencyId: gbp.id, toCurrencyId: pkr.id, rate: 380, source: "test" });
    await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      exchangeRateSnapshotId: rate.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 50 }],
    });

    // GBP order with NO rate — must be excluded from bookedValue, not added raw.
    await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 999999 }], // deliberately huge — must NOT show up
    });

    const balances = await getCustomerBalances();
    const line = balances.find((b) => b.customerId === customer.id);
    expect(line).toBeDefined();
    expect(line!.bookedValue.toNumber()).toBe(1000 + 19000); // the huge unconverted order is excluded
    expect(line!.needsExchangeRateCount).toBe(1);
  });

  it("recordCustomerReceipt compares a PKR receipt against the order's PKR-converted total, not its raw native number", async () => {
    const { user, channel } = await seedSalesReferenceData();
    const customer = await prisma.customer.create({ data: { name: `FX-Receipt-Customer-${randomUUID()}` } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const gbp = await gbpCurrency();
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const product = await prisma.product.create({ data: { skuCode: `SKU-${randomUUID()}`, name: "P", categoryId: category.id } });
    const account = await prisma.account.create({ data: { label: `PKR-${randomUUID()}`, currencyId: pkr.id, kind: "bank" } });

    const rate = await lockExchangeRate({ fromCurrencyId: gbp.id, toCurrencyId: pkr.id, rate: 375, source: "test" });
    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: gbp.id,
      exchangeRateSnapshotId: rate.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 10 }], // £10 = 3,750 PKR
    });

    const receiptRate = await lockExchangeRate({ fromCurrencyId: pkr.id, toCurrencyId: pkr.id, rate: 1, source: "test" });

    // A PKR receipt of 3,750 exactly matches the converted total — must succeed.
    await expect(
      recordCustomerReceipt({
        customerId: customer.id,
        currencyId: pkr.id,
        amount: 3750,
        receivedAt: new Date(),
        destinationAccountId: account.id,
        exchangeRateSnapshotId: receiptRate.id,
        allocations: [{ orderId: order.id, amount: 3750 }],
      }),
    ).resolves.toBeDefined();

    // A second PKR receipt of even 1 more PKR now overpays — must reject.
    await expect(
      recordCustomerReceipt({
        customerId: customer.id,
        currencyId: pkr.id,
        amount: 1,
        receivedAt: new Date(),
        destinationAccountId: account.id,
        exchangeRateSnapshotId: receiptRate.id,
        allocations: [{ orderId: order.id, amount: 1 }],
      }),
    ).rejects.toThrow(/overpay/);
  });
});
