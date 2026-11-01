import { describe, it, expect, beforeAll, afterAll } from "vitest";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";

/** New /sales/* endpoints are gated the same way as /products/:id/cost-layers — verify over real HTTP. */
describe("sales routes RBAC (HTTP)", () => {
  let app: FastifyInstance;
  let pickerToken: string;
  let sellerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const pickerRole = await prisma.role.findUniqueOrThrow({ where: { code: "picker" } });
    const picker = await prisma.user.upsert({
      where: { email: "picker.sales-http-test@example.com" },
      update: {},
      create: {
        name: "Sales HTTP Test Picker",
        email: "picker.sales-http-test@example.com",
        passwordHash: await argon2.hash("picker-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: picker.id, roleId: pickerRole.id } },
      update: {},
      create: { userId: picker.id, roleId: pickerRole.id },
    });

    const sellerRole = await prisma.role.findUniqueOrThrow({ where: { code: "seller" } });
    const seller = await prisma.user.upsert({
      where: { email: "seller.sales-http-test@example.com" },
      update: {},
      create: {
        name: "Sales HTTP Test Seller",
        email: "seller.sales-http-test@example.com",
        passwordHash: await argon2.hash("seller-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: seller.id, roleId: sellerRole.id } },
      update: {},
      create: { userId: seller.id, roleId: sellerRole.id },
    });

    pickerToken = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "picker.sales-http-test@example.com", password: "picker-test-pass" },
      })
    ).json().token;

    sellerToken = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "seller.sales-http-test@example.com", password: "seller-test-pass" },
      })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("denies a picker (no order.create) creating a sales order", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sales/orders",
      headers: { authorization: `Bearer ${pickerToken}` },
      payload: {
        orderNumber: "SO-TEST-1",
        channelId: "00000000-0000-0000-0000-000000000000",
        customerId: "00000000-0000-0000-0000-000000000000",
        currencyId: "00000000-0000-0000-0000-000000000000",
        lines: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a seller (no order.pick) posting a pick", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sales/picks",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        orderLineId: "00000000-0000-0000-0000-000000000000",
        costLayerId: "00000000-0000-0000-0000-000000000000",
        gradeId: "00000000-0000-0000-0000-000000000000",
        binId: "00000000-0000-0000-0000-000000000000",
        quantity: 1,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a picker (no profit.view) reading order-line profitability", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/sales/order-lines/00000000-0000-0000-0000-000000000000/profitability",
      headers: { authorization: `Bearer ${pickerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
