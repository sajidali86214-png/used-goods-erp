import { describe, it, expect, beforeAll, afterAll } from "vitest";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";

describe("finance routes RBAC (HTTP)", () => {
  let app: FastifyInstance;
  let pickerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const pickerRole = await prisma.role.findUniqueOrThrow({ where: { code: "picker" } });
    const picker = await prisma.user.upsert({
      where: { email: "picker.finance-http-test@example.com" },
      update: {},
      create: {
        name: "Finance HTTP Test Picker",
        email: "picker.finance-http-test@example.com",
        passwordHash: await argon2.hash("picker-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: picker.id, roleId: pickerRole.id } },
      update: {},
      create: { userId: picker.id, roleId: pickerRole.id },
    });

    pickerToken = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "picker.finance-http-test@example.com", password: "picker-test-pass" },
      })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("denies a picker (no finance.payment) locking an exchange rate", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/finance/exchange-rates",
      headers: { authorization: `Bearer ${pickerToken}` },
      payload: {
        fromCurrencyId: "00000000-0000-0000-0000-000000000000",
        toCurrencyId: "00000000-0000-0000-0000-000000000000",
        rate: 1,
        source: "test",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a picker (no finance.payment) recording a receipt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/finance/receipts",
      headers: { authorization: `Bearer ${pickerToken}` },
      payload: {
        currencyId: "00000000-0000-0000-0000-000000000000",
        amount: 100,
        receivedAt: new Date().toISOString(),
        destinationAccountId: "00000000-0000-0000-0000-000000000000",
        exchangeRateSnapshotId: "00000000-0000-0000-0000-000000000000",
        allocations: [{ orderId: "00000000-0000-0000-0000-000000000000", amount: 100 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a picker (no finance.payment) posting an expense to the ledger", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/finance/post/expenses/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${pickerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies a picker (no finance.report.view) reading an account balance", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/finance/accounts/00000000-0000-0000-0000-000000000000/balance",
      headers: { authorization: `Bearer ${pickerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
