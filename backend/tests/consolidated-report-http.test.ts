import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { rawPrisma } from "../src/lib/prisma.js";
import { runInBranchContext } from "../src/lib/branchContext.js";
import { TEST_MAIN_BRANCH_ID } from "./setup.js";

/**
 * Owner-only consolidated (all-branches) reporting — see
 * consolidatedReportService.ts. Two branches, each with its own inventory
 * (a cost layer), an owner login and a manager login. Owner's consolidated
 * call must sum both branches; manager (lacks reports.consolidated.view)
 * must get 403; owner's own PLAIN (non-consolidated) call must still return
 * only their own branch's number, proving the consolidated path never leaks
 * into the ordinary one.
 *
 * Main Branch already carries real accumulated inventory from the rest of
 * this test suite (and manual testing), so every assertion below compares a
 * captured BEFORE/AFTER delta, never an assumed absolute value — except for
 * branch B, which this test creates fresh, so its own number can be exact.
 */
describe("consolidated owner reporting (HTTP)", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let managerToken: string;
  let branchBId: string;
  let baselinePlainTotal: number;
  let baselineConsolidatedTotal: number;

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  async function seedInventory(branchId: string, unitCost: number) {
    await runInBranchContext(branchId, async () => {
      const pkr = await rawPrisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
      const category = await rawPrisma.category.create({ data: { branchId, name: `Cat-${randomUUID()}` } });
      const product = await rawPrisma.product.create({
        data: { branchId, skuCode: `SKU-${randomUUID()}`, name: "Consolidated Test Product", categoryId: category.id },
      });
      const grade = await rawPrisma.grade.create({ data: { branchId, code: `G-${randomUUID().slice(0, 6)}`, label: "Test Grade" } });
      const bin = await rawPrisma.bin.create({ data: { branchId, code: `BIN-${randomUUID()}`, label: "Test Bin" } });
      const lot = await rawPrisma.lot.create({
        data: {
          branchId,
          lotCode: `LOT-${randomUUID()}`,
          productId: product.id,
          originalCurrencyId: pkr.id,
          sourceUnitPrice: unitCost,
          exchangeRate: 1,
        },
      });
      await rawPrisma.costLayer.create({
        data: {
          branchId,
          lotId: lot.id,
          gradeId: grade.id,
          binId: bin.id,
          quantityOriginal: 1,
          quantityRemaining: 1,
          unitCost,
        },
      });
    });
  }

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const ownerRole = await rawPrisma.role.findUniqueOrThrow({ where: { code: "owner" } });
    const managerRole = await rawPrisma.role.findUniqueOrThrow({ where: { code: "manager" } });
    const branchB = await rawPrisma.branch.create({
      data: { name: `Branch-B-${randomUUID()}`, code: `B-${randomUUID().slice(0, 8)}` },
    });
    branchBId = branchB.id;

    const owner = await rawPrisma.user.create({
      data: {
        branchId: TEST_MAIN_BRANCH_ID,
        name: "Consolidated Test Owner",
        email: `owner-cons-${randomUUID()}@example.com`,
        passwordHash: await argon2.hash("owner-pass"),
      },
    });
    await rawPrisma.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });

    const manager = await rawPrisma.user.create({
      data: {
        branchId: TEST_MAIN_BRANCH_ID,
        name: "Consolidated Test Manager",
        email: `manager-cons-${randomUUID()}@example.com`,
        passwordHash: await argon2.hash("manager-pass"),
      },
    });
    await rawPrisma.userRole.create({ data: { userId: manager.id, roleId: managerRole.id } });

    const loginOwner = await app.inject({ method: "POST", url: "/auth/login", payload: { email: owner.email, password: "owner-pass" } });
    ownerToken = loginOwner.json().token;
    const loginManager = await app.inject({ method: "POST", url: "/auth/login", payload: { email: manager.email, password: "manager-pass" } });
    managerToken = loginManager.json().token;

    // Capture baselines BEFORE seeding new inventory, so later assertions
    // check deltas, not assumed-clean absolute values.
    const basePlain = await app.inject({ method: "GET", url: "/reports/inventory-valuation", headers: { authorization: `Bearer ${ownerToken}` } });
    baselinePlainTotal = Number(basePlain.json().totalValue);
    const baseConsolidated = await app.inject({
      method: "GET",
      url: "/reports/inventory-valuation?consolidated=true",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    baselineConsolidatedTotal = Number(baseConsolidated.json().combinedTotalValue);

    // Give Main Branch a real cost layer (inventory value) to sum.
    await seedInventory(TEST_MAIN_BRANCH_ID, 1000);
    // And branch B (freshly created, zero prior inventory) its own, separate value.
    await seedInventory(branchB.id, 500);
  });

  it("owner's consolidated call sums both branches' inventory value", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/inventory-valuation?consolidated=true",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { byBranch: { branchId: string; totalValue: string }[]; combinedTotalValue: string };

    // Combined total grew by exactly what was added to Main Branch (1000) + branch B (500).
    expect(Number(body.combinedTotalValue) - baselineConsolidatedTotal).toBe(1500);

    // Branch B is fresh, so its own entry's value can be asserted exactly.
    const branchBEntry = body.byBranch.find((b) => b.branchId === branchBId);
    expect(branchBEntry).toBeTruthy();
    expect(Number(branchBEntry!.totalValue)).toBe(500);
  });

  it("manager (no reports.consolidated.view) gets 403 on the consolidated call", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/inventory-valuation?consolidated=true",
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner's own plain (non-consolidated) call still returns only their own branch's number", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/inventory-valuation",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    // Grew by exactly Main Branch's own 1000 addition — branch B's 500 must NOT show up here.
    expect(Number(res.json().totalValue) - baselinePlainTotal).toBe(1000);
  });
});
