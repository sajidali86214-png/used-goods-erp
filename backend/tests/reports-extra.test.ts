import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { recordCustomerReceipt } from "../src/modules/finance/paymentService.js";
import { lockExchangeRate } from "../src/modules/finance/currencyService.js";
import { getStockAging, getSupplierBalances, getCustomerBalances } from "../src/modules/reports/reportService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("extra reports: stock aging, supplier balances, customer balances", () => {
  it("getStockAging reports a positive age and the right remaining quantity for a known lot", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeByCode.get("A")!.id, unitPrice: 500, quantity: 7, actorUserId: user.id });

    const aging = await getStockAging();
    const line = aging.find((a) => a.productId === product.id);
    expect(line).toBeDefined();
    expect(line!.quantityRemaining.toNumber()).toBe(7);
    expect(line!.oldestAgeDays).toBeGreaterThanOrEqual(0);
  });

  it("getSupplierBalances reflects an unapplied advance", async () => {
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const supplier = await prisma.supplier.create({ data: { name: `Balance-Supplier-${randomUUID()}`, defaultCurrencyId: pkr.id } });
    await prisma.supplierAdvance.create({
      data: { supplierId: supplier.id, currencyId: pkr.id, amount: 4000, paidAt: new Date(), paymentMethodAccountId: "manual-test" },
    });

    const balances = await getSupplierBalances();
    const line = balances.find((b) => b.supplierId === supplier.id);
    expect(line).toBeDefined();
    expect(line!.totalAdvancesPaid.toNumber()).toBe(4000);
    expect(line!.unappliedAdvance.toNumber()).toBe(4000);
  });

  it("getCustomerBalances reflects booked value minus actual receipts", async () => {
    const { product, currency, channel, customer, user } = await seedSalesReferenceData();

    const order = await createDraftOrder({
      orderNumber: `SO-BAL-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 2, unitPrice: 1000 }],
    });

    const rate = await lockExchangeRate({ fromCurrencyId: currency.id, toCurrencyId: currency.id, rate: 1, source: "test" });
    const account = await prisma.account.create({ data: { label: `Bal-Bank-${randomUUID()}`, currencyId: currency.id, kind: "bank" } });
    await recordCustomerReceipt({
      currencyId: currency.id,
      amount: 800,
      receivedAt: new Date(),
      destinationAccountId: account.id,
      exchangeRateSnapshotId: rate.id,
      allocations: [{ orderId: order.id, amount: 800 }],
    });

    const balances = await getCustomerBalances();
    const line = balances.find((b) => b.customerId === customer.id);
    expect(line).toBeDefined();
    expect(line!.bookedValue.toNumber()).toBe(2000);
    expect(line!.received.toNumber()).toBe(800);
    expect(line!.outstanding.toNumber()).toBe(1200);
  });
});
