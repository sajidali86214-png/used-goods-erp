import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { generateSkuCode } from "../src/modules/masterdata/skuGenerator.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SKU auto-generation", () => {
  it("builds a readable prefix from the category name and increments per category", async () => {
    const category = await prisma.category.create({ data: { name: `Handbags-${randomUUID().slice(0, 8)}` } });

    const sku1 = await generateSkuCode(category.id);
    expect(sku1).toMatch(/^HANDBAGS[A-Z0-9]*-0001$/);

    await prisma.product.create({ data: { skuCode: sku1, name: "First", categoryId: category.id } });

    const sku2 = await generateSkuCode(category.id);
    expect(sku2).not.toBe(sku1);
    expect(sku2.endsWith("-0002")).toBe(true);
  });

  it("never collides even if a product already occupies the next sequence number", async () => {
    const category = await prisma.category.create({ data: { name: `Scarves-${randomUUID().slice(0, 8)}` } });
    const prefix = category.name.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Pre-occupy seq 0001 directly, bypassing the generator.
    await prisma.product.create({ data: { skuCode: `${prefix}-0001`, name: "Manually seeded", categoryId: category.id } });

    const sku = await generateSkuCode(category.id);
    expect(sku).not.toBe(`${prefix}-0001`);
    const existing = await prisma.product.findUnique({ where: { skuCode: sku } });
    expect(existing).toBeNull();
  });
});

describe("Brand master data", () => {
  it("can be created and linked to a product via brandId", async () => {
    const category = await prisma.category.create({ data: { name: `Cat-${randomUUID()}` } });
    const brand = await prisma.brand.create({ data: { name: `Nike-${randomUUID().slice(0, 8)}` } });
    const skuCode = await generateSkuCode(category.id);

    const product = await prisma.product.create({
      data: { skuCode, name: "Branded item", categoryId: category.id, brandId: brand.id },
      include: { brand: true },
    });

    expect(product.brand?.id).toBe(brand.id);
    expect(product.brand?.name).toBe(brand.name);
  });
});
