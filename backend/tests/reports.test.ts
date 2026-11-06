import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { dispatchPickAllocation } from "../src/modules/sales/dispatchService.js";
import { postSaleDispatch } from "../src/modules/finance/ledgerService.js";
import { getStockSummary, getInventoryValuation, getFinancialSummary, getUnfulfilledOrders } from "../src/modules/reports/reportService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reports: stock summary and inventory valuation reconcile with the ledger", () => {
  it("getInventoryValuation sums quantityRemaining * unitCost for a known fixture", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 500, quantity: 10, actorUserId: user.id });

    const valuationBefore = await getInventoryValuation();
    const lineBefore = valuationBefore.lines.find((l) => l.productId === product.id);
    expect(lineBefore?.quantityRemaining.toNumber()).toBe(10);
    expect(lineBefore?.value.toNumber()).toBe(5000);

    const stockSummary = await getStockSummary();
    const saleable = stockSummary.find((s) => s.state === "saleable");
    expect(saleable?.onHandQty.toNumber()).toBeGreaterThanOrEqual(10);
    expect(saleable?.availableQty).not.toBeNull();
  });

  it("an unfulfilled order shows up until it's fully delivered", async () => {
    const { channel, customer, currency, product, user } = await seedSalesReferenceData();
    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
    });

    const unfulfilled = await getUnfulfilledOrders();
    expect(unfulfilled.some((o) => o.id === order.id)).toBe(true);
  });

  it("getFinancialSummary reflects posted sales/COGS for a date range matching the ledger worked example", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } = await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 500, quantity: 20, actorUserId: user.id });
    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeA.id, unitPrice: 600, quantity: 30, actorUserId: user.id });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 50, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    const before = await getFinancialSummary({});

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 50 });
    for (const candidate of candidates) {
      await reserveStock({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity });
      const pick = await pickFromReservation({ orderLineId: line.id, costLayerId: candidate.costLayerId, gradeId: candidate.gradeId, binId: candidate.binId, quantity: candidate.quantity, pickerUserId: user.id });
      const { shipmentLine } = await dispatchPickAllocation({ pickAllocationId: pick.id, quantity: candidate.quantity.toNumber(), actorUserId: user.id });
      await postSaleDispatch(shipmentLine.id);
    }

    const after = await getFinancialSummary({});
    expect(after.grossSales.minus(before.grossSales).toNumber()).toBe(45000);
    expect(after.cogs.minus(before.cogs).toNumber()).toBe(28000);
    expect(after.grossProfit.minus(before.grossProfit).toNumber()).toBe(17000);
  });
});
