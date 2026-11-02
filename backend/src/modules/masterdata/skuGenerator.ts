import { prisma } from "../../lib/prisma.js";

/**
 * Auto-generates a SKU code from the product's category name, e.g.
 * "Bags" -> "BAGS-0001", "Dresses" -> "DRESSES-0001". SKUs are never
 * typed by hand — the owner picks a category, the system assigns the
 * code — per the business's own preference, not a spec requirement.
 */
export async function generateSkuCode(categoryId: string): Promise<string> {
  const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
  const prefix = category.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "ITEM";

  const existingCount = await prisma.product.count({ where: { skuCode: { startsWith: `${prefix}-` } } });
  let seq = existingCount + 1;

  // Extremely unlikely to collide (would need a concurrent create in the
  // same category at the same moment), but retry a few times just in case
  // rather than letting the DB's unique constraint bubble up as a 500.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${prefix}-${String(seq).padStart(4, "0")}`;
    const taken = await prisma.product.findUnique({ where: { skuCode: candidate } });
    if (!taken) return candidate;
    seq += 1;
  }
  throw new Error("Could not generate a unique SKU code — please retry");
}
