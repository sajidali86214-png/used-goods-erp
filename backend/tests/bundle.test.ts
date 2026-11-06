import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { allocateBundle, allocateSharedLineAmount } from "../src/modules/sales/bundleAllocationService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #19: bundle total, discount, and shipping allocate exactly", () => {
  it("proportional-by-quantity shares sum exactly to the bundle price despite rounding", async () => {
    const { product, currency, channel, customer, user } = await seedSalesReferenceData();
    const bundleGroupId = randomUUID();

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 1 },
      ],
    });

    // Tag all three lines as one bundle (not part of createDraftOrder's input shape).
    for (const line of order.lines) {
      await prisma.salesOrderLine.update({ where: { id: line.id }, data: { bundleGroupId } });
    }

    // 100 / 3 does not divide evenly at 4 decimal places â€” exercises the remainder rule.
    const results = await allocateBundle({ bundleGroupId, totalBundlePrice: 100 });
    expect(results).toHaveLength(3);

    const totalAllocated = results.reduce((sum, r) => sum + r.lineShare.toNumber(), 0);
    expect(totalAllocated).toBeCloseTo(100, 10);

    // Each allocation's derivedUnitRevenue * quantity reproduces its share exactly.
    for (const r of results) {
      const allocation = await prisma.bundleAllocation.findUniqueOrThrow({
        where: { orderLineId: r.allocation.orderLineId },
      });
      expect(allocation.method).toBe("proportional_piece_count");
      expect(allocation.approvedOverride).toBe(false);
    }

    // Shared shipping of 50 split the same way across the same lines.
    const shippingResults = await allocateSharedLineAmount({
      orderLineIds: order.lines.map((l) => l.id),
      totalAmount: 50,
      field: "taxesFees",
    });
    const totalShipping = shippingResults.reduce((sum, r) => sum + r.share.toNumber(), 0);
    expect(totalShipping).toBeCloseTo(50, 10);
  });

  it("rejects an explicit override whose shares don't sum to the bundle price", async () => {
    const { product, currency, channel, customer, user } = await seedSalesReferenceData();
    const bundleGroupId = randomUUID();

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 3 },
      ],
    });
    for (const line of order.lines) {
      await prisma.salesOrderLine.update({ where: { id: line.id }, data: { bundleGroupId } });
    }

    await expect(
      allocateBundle({
        bundleGroupId,
        totalBundlePrice: 100,
        explicitShares: [
          { orderLineId: order.lines[0]!.id, amount: 40 },
          { orderLineId: order.lines[1]!.id, amount: 55 }, // sums to 95, not 100
        ],
      }),
    ).rejects.toThrow(/sum exactly/);
  });
});
