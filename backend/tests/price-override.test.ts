import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("price.override: a line priced below the product's minPrice is gated and audited", () => {
  it("rejects without price.override permission, requires a reason, and logs an audit event when both are present", async () => {
    const { channel, customer, currency, user } = await seedSalesReferenceData();
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const product = await prisma.product.create({
      data: { skuCode: `SKU-${randomUUID()}`, name: "Priced item", categoryId: category.id, minPrice: 500 },
    });

    await expect(
      createDraftOrder({
        orderNumber: `SO-${randomUUID()}`,
        channelId: channel.id,
        customerId: customer.id,
        currencyId: currency.id,
        actorUserId: user.id,
        actorHasPriceOverride: false,
        lines: [{ productId: product.id, quantity: 1, unitPrice: 300 }],
      }),
    ).rejects.toThrow(/price\.override/);

    await expect(
      createDraftOrder({
        orderNumber: `SO-${randomUUID()}`,
        channelId: channel.id,
        customerId: customer.id,
        currencyId: currency.id,
        actorUserId: user.id,
        actorHasPriceOverride: true,
        lines: [{ productId: product.id, quantity: 1, unitPrice: 300 }], // no priceOverrideReason
      }),
    ).rejects.toThrow(/priceOverrideReason/);

    const order = await createDraftOrder({
      orderNumber: `SO-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: true,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 300, priceOverrideReason: "Clearance sale, manager approved" }],
    });

    const auditEvents = await prisma.auditEvent.findMany({
      where: { entityType: "SalesOrderLine", entityId: order.lines[0]!.id, action: "price_override" },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.reason).toMatch(/Clearance sale/);

    // A normally-priced line (no minPrice violation) needs no permission or reason at all.
    const normalOrder = await createDraftOrder({
      orderNumber: `SO-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 600 }],
    });
    expect(normalOrder.lines[0]!.unitPrice?.toNumber()).toBe(600);
  });
});
