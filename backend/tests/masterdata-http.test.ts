import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";

describe("master-data routes: CRUD works and settings.manage is enforced", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let pickerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: "owner" } });
    const owner = await prisma.user.upsert({
      where: { email: "owner.masterdata-test@example.com" },
      update: {},
      create: { name: "Owner MD Test", email: "owner.masterdata-test@example.com", passwordHash: await argon2.hash("owner-test-pass") },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
      update: {},
      create: { userId: owner.id, roleId: ownerRole.id },
    });

    const pickerRole = await prisma.role.findUniqueOrThrow({ where: { code: "picker" } });
    const picker = await prisma.user.upsert({
      where: { email: "picker.masterdata-test@example.com" },
      update: {},
      create: { name: "Picker MD Test", email: "picker.masterdata-test@example.com", passwordHash: await argon2.hash("picker-test-pass") },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: picker.id, roleId: pickerRole.id } },
      update: {},
      create: { userId: picker.id, roleId: pickerRole.id },
    });

    ownerToken = (await app.inject({ method: "POST", url: "/auth/login", payload: { email: "owner.masterdata-test@example.com", password: "owner-test-pass" } })).json().token;
    pickerToken = (await app.inject({ method: "POST", url: "/auth/login", payload: { email: "picker.masterdata-test@example.com", password: "picker-test-pass" } })).json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("owner can create a category, product, supplier, and customer end to end", async () => {
    const categoryRes = await app.inject({
      method: "POST",
      url: "/settings/categories",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: `Category-${randomUUID()}` },
    });
    expect(categoryRes.statusCode).toBe(201);
    const category = categoryRes.json();

    const productRes = await app.inject({
      method: "POST",
      url: "/products",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { skuCode: `SKU-${randomUUID()}`, name: "Test Product", categoryId: category.id },
    });
    expect(productRes.statusCode).toBe(201);

    const listRes = await app.inject({ method: "GET", url: "/products", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(listRes.statusCode).toBe(200);
    expect(Array.isArray(listRes.json())).toBe(true);

    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const supplierRes = await app.inject({
      method: "POST",
      url: "/suppliers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: pkr.id },
    });
    expect(supplierRes.statusCode).toBe(201);

    const customerRes = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: `Customer-${randomUUID()}` },
    });
    expect(customerRes.statusCode).toBe(201);
  });

  it("a picker (no settings.manage) is denied creating a category or product", async () => {
    const categoryRes = await app.inject({
      method: "POST",
      url: "/settings/categories",
      headers: { authorization: `Bearer ${pickerToken}` },
      payload: { name: `Category-${randomUUID()}` },
    });
    expect(categoryRes.statusCode).toBe(403);

    const productRes = await app.inject({
      method: "POST",
      url: "/products",
      headers: { authorization: `Bearer ${pickerToken}` },
      payload: { skuCode: `SKU-${randomUUID()}`, name: "Should not be created", categoryId: randomUUID() },
    });
    expect(productRes.statusCode).toBe(403);
  });

  it("a picker can still read reference data (grades, bins, channels) with no settings.manage", async () => {
    const res = await app.inject({ method: "GET", url: "/settings/grades", headers: { authorization: `Bearer ${pickerToken}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
