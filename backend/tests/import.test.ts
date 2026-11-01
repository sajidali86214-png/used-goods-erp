import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { commitProductImport, commitOpeningStockImport } from "../src/modules/imports/importService.js";
import { seedReferenceData } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #17: invalid and duplicate rows never produce a silent partial document", () => {
  it("all-or-nothing import creates nothing when any row is invalid, and reports every error", async () => {
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const goodSku = `SKU-${randomUUID()}`;

    const rows = [
      { skuCode: goodSku, name: "Good Jeans", categoryId: category.id },
      { skuCode: "", name: "Missing SKU", categoryId: category.id }, // invalid: missing skuCode
      { skuCode: goodSku, name: "Duplicate of row 1", categoryId: category.id }, // duplicate within file
    ];

    const job = await commitProductImport({ fileRef: `test/${randomUUID()}.csv`, rows, allOrNothing: true });
    expect(job.status).toBe("failed");

    const errors = job.errors as unknown as { row: number; message: string }[];
    expect(errors.some((e) => e.row === 2 && /skuCode is required/.test(e.message))).toBe(true);
    expect(errors.some((e) => e.row === 3 && /Duplicate skuCode/.test(e.message))).toBe(true);

    // Nothing was created — not even the one valid-looking row.
    const created = await prisma.product.findMany({ where: { skuCode: goodSku } });
    expect(created).toHaveLength(0);
  });

  it("a partial-accept import creates only the valid rows and records the rest as skipped", async () => {
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const goodSku = `SKU-${randomUUID()}`;
    const badCategoryId = randomUUID();

    const rows = [
      { skuCode: goodSku, name: "Good Jeans", categoryId: category.id },
      { skuCode: `SKU-${randomUUID()}`, name: "Bad Category", categoryId: badCategoryId },
    ];

    const job = await commitProductImport({ fileRef: `test/${randomUUID()}.csv`, rows, allOrNothing: false });
    expect(job.status).toBe("partially_committed");

    const summary = job.resultSummary as unknown as { createdCount: number; skippedCount: number };
    expect(summary.createdCount).toBe(1);
    expect(summary.skippedCount).toBe(1);

    const created = await prisma.product.findMany({ where: { skuCode: goodSku } });
    expect(created).toHaveLength(1);
  });

  it("re-importing a SKU that already exists is rejected, never silently duplicated or overwritten", async () => {
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const sku = `SKU-${randomUUID()}`;

    const firstJob = await commitProductImport({
      fileRef: `test/${randomUUID()}.csv`,
      rows: [{ skuCode: sku, name: "Original Name", categoryId: category.id }],
    });
    expect(firstJob.status).toBe("committed");

    // Accidentally re-uploaded with a different name for the same SKU.
    const secondJob = await commitProductImport({
      fileRef: `test/${randomUUID()}.csv`,
      rows: [{ skuCode: sku, name: "Renamed By Accident", categoryId: category.id }],
    });
    expect(secondJob.status).toBe("failed");
    const errors = secondJob.errors as unknown as { row: number; message: string }[];
    expect(errors.some((e) => /already exists/.test(e.message))).toBe(true);

    const products = await prisma.product.findMany({ where: { skuCode: sku } });
    expect(products).toHaveLength(1);
    expect(products[0]!.name).toBe("Original Name"); // never overwritten
  });
});

describe("opening-stock import (spec section 17 go-live cutover)", () => {
  it("creates a lot/cost-layer/saleable-state per row and never duplicates the same file", async () => {
    const { product, currency, bin } = await seedReferenceData();
    const grade = await prisma.grade.upsert({ where: { code: "A" }, update: {}, create: { code: "A", label: "Grade A" } });
    const fileRef = `opening-stock-${randomUUID()}.csv`;

    const job = await commitOpeningStockImport({
      fileRef,
      actorUserId: (await prisma.user.create({ data: { name: "Importer", email: `importer-${randomUUID()}@example.com`, passwordHash: "x" } })).id,
      rows: [
        { skuCode: product.skuCode, gradeCode: grade.code, binCode: bin.code, quantity: 25, unitCost: 450, currencyId: currency.id, costIsEstimated: true },
      ],
    });
    expect(job.status).toBe("committed");

    const state = await prisma.stockState.findFirst({
      where: { productId: product.id, gradeId: grade.id, binId: bin.id, state: "saleable" },
    });
    expect(state?.onHandQty.toNumber()).toBe(25);

    const movement = await prisma.stockMovement.findFirst({ where: { type: "opening_stock", productId: product.id } });
    expect(movement?.quantity.toNumber()).toBe(25);

    // Re-running the exact same file must be rejected, not silently duplicate the balance.
    await expect(
      commitOpeningStockImport({
        fileRef,
        actorUserId: movement!.actorUserId,
        rows: [
          { skuCode: product.skuCode, gradeCode: grade.code, binCode: bin.code, quantity: 25, unitCost: 450, currencyId: currency.id },
        ],
      }),
    ).rejects.toThrow(/was already committed/);

    const stateAfterRetry = await prisma.stockState.findFirst({
      where: { productId: product.id, gradeId: grade.id, binId: bin.id, state: "saleable" },
    });
    expect(stateAfterRetry?.onHandQty.toNumber()).toBe(25); // unchanged — no duplicate balance
  });
});
