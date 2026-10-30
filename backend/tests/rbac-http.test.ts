import { describe, it, expect, beforeAll, afterAll } from "vitest";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Acceptance test #16, exercised through real HTTP (Fastify inject), not just
 * the unit-tested middleware function: a role without cost.view must be
 * denied by the backend even with a valid token, regardless of what any
 * client UI would have hidden.
 */
describe("acceptance test #16 (HTTP): backend denies cost.view to a picker", () => {
  let app: FastifyInstance;
  let pickerToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const pickerRole = await prisma.role.findUniqueOrThrow({ where: { code: "picker" } });
    const picker = await prisma.user.upsert({
      where: { email: "picker.rbac-http-test@example.com" },
      update: {},
      create: {
        name: "RBAC HTTP Test Picker",
        email: "picker.rbac-http-test@example.com",
        passwordHash: await argon2.hash("picker-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: picker.id, roleId: pickerRole.id } },
      update: {},
      create: { userId: picker.id, roleId: pickerRole.id },
    });

    const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: "finance" } });
    const finance = await prisma.user.upsert({
      where: { email: "finance.rbac-http-test@example.com" },
      update: {},
      create: {
        name: "RBAC HTTP Test Finance",
        email: "finance.rbac-http-test@example.com",
        passwordHash: await argon2.hash("finance-test-pass"),
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: finance.id, roleId: financeRole.id } },
      update: {},
      create: { userId: finance.id, roleId: financeRole.id },
    });

    const pickerLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "picker.rbac-http-test@example.com", password: "picker-test-pass" },
    });
    pickerToken = pickerLogin.json().token;

    const financeLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "finance.rbac-http-test@example.com", password: "finance-test-pass" },
    });
    ownerToken = financeLogin.json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns 401 with no token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/products/00000000-0000-0000-0000-000000000000/cost-layers",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a picker (no cost.view)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/products/00000000-0000-0000-0000-000000000000/cost-layers",
      headers: { authorization: `Bearer ${pickerToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "forbidden", required: "cost.view" });
  });

  it("returns 200 for finance (has cost.view)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/products/00000000-0000-0000-0000-000000000000/cost-layers",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
