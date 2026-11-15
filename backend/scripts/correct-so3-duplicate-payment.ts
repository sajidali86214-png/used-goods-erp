/**
 * One-time correction: SO-0003 ended up with two real 10,000 PKR payment
 * receipts (20,000 total) against a 10,000 order — one created by this
 * session's backfill-order-ledger.ts migration script (tagged with a
 * distinctive "Backfill for ..." bankReference), and a second one recorded
 * separately through the normal UI, apparently unaware the first already
 * existed. The owner confirmed the real-world payment was 10,000, received
 * once. This removes the synthetic backfill-created receipt (the one that
 * was never a real bank event) and its ledger postings, leaving the
 * genuine UI-recorded receipt untouched.
 *
 * Refuses to change anything unless the data matches exactly what's
 * expected: exactly two allocations against SO-0003 totalling 20,000, one
 * of them tagged with the backfill script's bankReference text.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/correct-so3-duplicate-payment.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { Decimal } from "../src/lib/money.js";

async function main() {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { orderNumber: "SO-0003" } });

  const allocations = await prisma.paymentAllocation.findMany({
    where: { orderId: order.id },
    include: { paymentReceipt: true },
  });

  console.log(`SO-0003 (${order.id}): ${allocations.length} payment allocation(s) found.`);
  for (const a of allocations) {
    console.log(
      `  allocation ${a.id} amount=${a.amount.toString()} receiptId=${a.paymentReceiptId} createdAt=${a.paymentReceipt?.createdAt.toISOString()} bankRef=${JSON.stringify(a.paymentReceipt?.bankReference)}`,
    );
  }

  const total = allocations.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
  if (allocations.length !== 2 || !total.equals(new Decimal(20000))) {
    throw new Error(
      `Refusing to proceed: expected exactly 2 allocations totalling 20000, found ${allocations.length} totalling ${total.toString()}. Data no longer matches what this correction was written for — stop and re-investigate instead of running this.`,
    );
  }

  const backfillOnes = allocations.filter((a) => a.paymentReceipt?.bankReference?.startsWith("Backfill for"));
  if (backfillOnes.length !== 1) {
    throw new Error(
      `Refusing to proceed: expected exactly 1 allocation tagged as a backfill artifact, found ${backfillOnes.length}.`,
    );
  }
  const duplicate = backfillOnes[0];
  const keeper = allocations.find((a) => a.id !== duplicate.id)!;
  if (!duplicate.amount.equals(new Decimal(10000)) || !keeper.amount.equals(new Decimal(10000))) {
    throw new Error("Refusing to proceed: expected both allocations to be exactly 10000 each.");
  }

  console.log(`\nWill remove the synthetic backfill receipt ${duplicate.paymentReceiptId} (allocation ${duplicate.id}, 10000).`);
  console.log(`Will KEEP the genuine receipt ${keeper.paymentReceiptId} (allocation ${keeper.id}, 10000).`);

  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: { relatedDocumentType: "PaymentReceipt", relatedDocumentId: duplicate.paymentReceiptId },
  });
  console.log(`Found ${ledgerEntries.length} ledger entry(ies) posted for the duplicate receipt — will remove those too.`);

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({
      where: { relatedDocumentType: "PaymentReceipt", relatedDocumentId: duplicate.paymentReceiptId },
    });
    await tx.paymentAllocation.delete({ where: { id: duplicate.id } });
    await tx.paymentReceipt.delete({ where: { id: duplicate.paymentReceiptId } });
  });

  console.log("\nDone. SO-0003 now shows exactly one 10000 payment, matching the confirmed real-world amount.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
