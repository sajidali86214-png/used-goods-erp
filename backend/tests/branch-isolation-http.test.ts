import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { rawPrisma } from "../src/lib/prisma.js";
import { TEST_MAIN_BRANCH_ID } from "./setup.js";

/**
 * The core cross-branch leak test from the multi-branch data-isolation plan:
 * two real branches, two real logged-in users (real JWTs via real
 * /auth/login, not a hand-set context), one supplier each. Branch A's token
 * must never see branch B's supplier — not via list, not via direct-by-id
 * fetch, not as a referenceable id when creating a PO.
 */
describe("branch isolation (HTTP, real logins)", () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;
  let supplierA: { id: string; name: string };
  let supplierB: { id: string; name: string };

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const ownerRole = await rawPrisma.role.findUniqueOrThrow({ where: { code: "owner" } });

    const branchB = await rawPrisma.branch.create({
      data: { name: `Branch-B-${randomUUID()}`, code: `B-${randomUUID().slice(0, 8)}` },
    });

    const userA = await rawPrisma.user.create({
      data: {
        branchId: TEST_MAIN_BRANCH_ID,
        name: "Branch A Owner",
        email: `owner-a-${randomUUID()}@example.com`,
        passwordHash: await argon2.hash("test-pass-a"),
      },
    });
    await rawPrisma.userRole.create({ data: { userId: userA.id, roleId: ownerRole.id } });

    const userB = await rawPrisma.user.create({
      data: {
        branchId: branchB.id,
        name: "Branch B Owner",
        email: `owner-b-${randomUUID()}@example.com`,
        passwordHash: await argon2.hash("test-pass-b"),
      },
    });
    await rawPrisma.userRole.create({ data: { userId: userB.id, roleId: ownerRole.id } });

    const pkr = await rawPrisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    supplierA = await rawPrisma.supplier.create({
      data: { branchId: TEST_MAIN_BRANCH_ID, name: `Supplier-A-${randomUUID()}`, defaultCurrencyId: pkr.id },
    });
    supplierB = await rawPrisma.supplier.create({
      data: { branchId: branchB.id, name: `Supplier-B-${randomUUID()}`, defaultCurrencyId: pkr.id },
    });

    const loginA = await app.inject({ method: "POST", url: "/auth/login", payload: { email: userA.email, password: "test-pass-a" } });
    tokenA = loginA.json().token;
    const loginB = await app.inject({ method: "POST", url: "/auth/login", payload: { email: userB.email, password: "test-pass-b" } });
    tokenB = loginB.json().token;
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
  });

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  it("never lists another branch's supplier", async () => {
    const res = await app.inject({ method: "GET", url: "/suppliers", headers: { authorization: `Bearer ${tokenA}` } });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((s: { name: string }) => s.name);
    expect(names).toContain(supplierA.name);
    expect(names).not.toContain(supplierB.name);
  });

  it("never fetches another branch's supplier by id directly", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/suppliers/${supplierB.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects creating a PO against another branch's supplier id", async () => {
    const pkr = await rawPrisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const category = await rawPrisma.category.create({ data: { branchId: TEST_MAIN_BRANCH_ID, name: `Cat-${randomUUID()}` } });
    const product = await rawPrisma.product.create({
      data: { branchId: TEST_MAIN_BRANCH_ID, skuCode: `SKU-${randomUUID()}`, name: "Test Product", categoryId: category.id },
    });

    const res = await app.inject({
      method: "POST",
      url: "/purchasing/orders",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        supplierId: supplierB.id,
        currencyId: pkr.id,
        lines: [{ productId: product.id, orderedQty: 1, unitPrice: 100 }],
      },
    });
    expect(res.statusCode).toBe(500); // findUniqueOrThrow rejects — not a clean 4xx yet, but it does NOT silently create
    const posReferencingB = await rawPrisma.purchaseOrder.findMany({ where: { supplierId: supplierB.id, branchId: TEST_MAIN_BRANCH_ID } });
    expect(posReferencingB).toHaveLength(0);
  });

  it("branch B's own token still sees its own supplier fine", async () => {
    const res = await app.inject({ method: "GET", url: "/suppliers", headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((s: { name: string }) => s.name);
    expect(names).toContain(supplierB.name);
    expect(names).not.toContain(supplierA.name);
  });
});
