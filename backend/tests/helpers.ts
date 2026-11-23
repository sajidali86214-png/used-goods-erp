import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

/** Minimal reference data each test needs: currency, grades, a bin, and a product. */
export async function seedReferenceData() {
  const currency = await prisma.currency.upsert({
    where: { code: "PKR" },
    update: {},
    create: { code: "PKR", symbol: "Rs" },
  });

  for (const code of ["A", "B", "C", "UNGRADED"]) {
    const existing = await prisma.grade.findFirst({ where: { code } });
    if (!existing) await prisma.grade.create({ data: { code, label: code } });
  }

  const bin =
    (await prisma.bin.findFirst({ where: { code: "MAIN" } })) ??
    (await prisma.bin.create({ data: { code: "MAIN", label: "Main warehouse" } }));

  const category = await prisma.category.create({ data: { name: `Category-${randomUUID()}` } });

  const product = await prisma.product.create({
    data: {
      skuCode: `SKU-${randomUUID()}`,
      name: "Test Jeans",
      categoryId: category.id,
    },
  });

  const grades = await prisma.grade.findMany();
  const gradeByCode = new Map(grades.map((g) => [g.code, g]));

  const user = await prisma.user.create({
    data: { name: "Test User", email: `test-${randomUUID()}@example.com`, passwordHash: "x" },
  });

  return { currency, bin, product, gradeByCode, user };
}
