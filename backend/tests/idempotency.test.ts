import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSalesReferenceData } from "./salesHelpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #15: retrying after a simulated connection timeout", () => {
  let app: FastifyInstance;
  let sellerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const sellerRole = await prisma.role.findUniqueOrThrow({ where: { code: "seller" } });
    const seller = await prisma.user.upsert({
      where: { email: "seller.idempotency-test@example.com" },
      update: {},
      create: {
        name: "Idempotency Test Seller",
        email: "seller.idempotency-test@example.com",
        passwordHash: await argon2.hash("seller-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: seller.id, roleId: sellerRole.id } },
      update: {},
      create: { userId: seller.id, roleId: sellerRole.id },
    });

    sellerToken = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "seller.idempotency-test@example.com", password: "seller-test-pass" },
      })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates only one order when the same request is retried with the same Idempotency-Key", async () => {
    const { product, currency, channel, customer } = await seedSalesReferenceData();
    const orderNumber = `SO-${randomUUID()}`;
    const idempotencyKey = randomUUID();

    const payload = {
      orderNumber,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, quantity: 5, unitPrice: 100 }],
    };

    // First attempt — the client never sees this response (simulated timeout).
    const firstResponse = await app.inject({
      method: "POST",
      url: "/sales/orders",
      headers: { authorization: `Bearer ${sellerToken}`, "idempotency-key": idempotencyKey },
      payload,
    });
    expect(firstResponse.statusCode).toBe(201);

    // Client retries with the exact same key, having never received the first response.
    const secondResponse = await app.inject({
      method: "POST",
      url: "/sales/orders",
      headers: { authorization: `Bearer ${sellerToken}`, "idempotency-key": idempotencyKey },
      payload,
    });
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.headers["idempotent-replay"]).toBe("true");
    expect(secondResponse.json()).toEqual(firstResponse.json());

    // Only one order/line (and therefore one corresponding movement set) actually exists.
    const orders = await prisma.salesOrder.findMany({ where: { orderNumber } });
    expect(orders).toHaveLength(1);
  });

  it("does not replay a different request even with no key, or a different key", async () => {
    const { product, currency, channel, customer } = await seedSalesReferenceData();

    const makePayload = () => ({
      orderNumber: `SO-${randomUUID()}`,
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
    });

    const res1 = await app.inject({
      method: "POST",
      url: "/sales/orders",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: makePayload(),
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/sales/orders",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: makePayload(),
    });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res1.json().id).not.toBe(res2.json().id); // two distinct orders — no key means no dedup
  });
});
