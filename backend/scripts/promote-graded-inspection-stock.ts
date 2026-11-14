/**
 * One-time migration: finds every StockState row sitting in "inspection"
 * that already has a real (non-UNGRADED) grade — meaning the receiver
 * specified the grade at receiving time, before the stockService fix that
 * sends such stock straight to "saleable" — and promotes it, using the
 * same grade and bin it already has. Uses the existing, already-tested
 * gradeTransfer function (quantity and cost are conserved by construction)
 * rather than writing new stock-mutation logic.
 *
 * Usage: DATABASE_URL=... SEED_OWNER_EMAIL=... npx tsx scripts/promote-graded-inspection-stock.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { gradeTransfer } from "../src/modules/stock/stockService.js";

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const ungraded = await prisma.grade.findUniqueOrThrow({ where: { code: "UNGRADED" } });

  const rows = await prisma.stockState.findMany({
    where: { state: "inspection", onHandQty: { gt: 0 }, gradeId: { not: ungraded.id } },
    include: { product: true, grade: true, bin: true },
  });
  console.log(`Found ${rows.length} already-graded inspection row(s) to promote.`);

  for (const row of rows) {
    console.log(`  ${row.product.skuCode} — grade ${row.grade.code} — ${row.onHandQty.toString()} pcs (bin ${row.bin.code})`);
    await gradeTransfer({
      sourceCostLayerId: row.costLayerId,
      splits: [{ gradeId: row.gradeId, binId: row.binId, quantity: row.onHandQty }],
      actorUserId: owner.id,
      destinationState: "saleable",
    });
  }

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
