/**
 * One-time migration: posts the real stock/ledger events for sales orders
 * that were marked dispatched/delivered/paid via the old manual-label-only
 * quick popups, before the real reserve/pick/dispatch/post and
 * record-payment pipelines existed. Idempotent — safe to re-run; an order
 * with nothing left to fulfil or already backed by a real receipt is a
 * no-op.
 *
 * Usage: DATABASE_URL=... SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... DEFAULT_RECEIPT_ACCOUNT_LABEL=... npx tsx scripts/backfill-order-ledger.ts
 */
import { prisma } from "../src/lib/prisma.js";
import { autoFulfilAndDispatchOrder } from "../src/modules/sales/fulfilmentAutomationService.js";
import { recordCustomerReceipt } from "../src/modules/finance/paymentService.js";
import { postCustomerReceipt } from "../src/modules/finance/ledgerService.js";
import { lockExchangeRate } from "../src/modules/finance/currencyService.js";
import { getOrderPaymentSummary } from "../src/modules/sales/salesOrderService.js";

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

  const defaultAccountLabel = process.env.DEFAULT_RECEIPT_ACCOUNT_LABEL;
  if (!defaultAccountLabel) throw new Error("Set DEFAULT_RECEIPT_ACCOUNT_LABEL to the account label historical payments should post into.");
  const defaultAccount = await prisma.account.findFirstOrThrow({ where: { label: defaultAccountLabel, currencyId: pkr.id } });
  console.log(`Backfilling as ${ownerEmail}; historical receipts will post into "${defaultAccount.label}".`);

  const orders = await prisma.salesOrder.findMany({
    where: {
      OR: [
        { fulfilmentStatus: { in: ["dispatched", "delivered", "partially_dispatched", "partially_delivered"] } },
        { paymentReceivedAmount: { not: null } },
      ],
    },
  });
  console.log(`Found ${orders.length} order(s) to check.`);

  for (const order of orders) {
    console.log(`\n--- ${order.orderNumber} ---`);

    if (["dispatched", "delivered", "partially_dispatched", "partially_delivered"].includes(order.fulfilmentStatus)) {
      try {
        const result = await autoFulfilAndDispatchOrder(order.id, owner.id);
        const fulfilledQty = result.fulfilled.reduce((sum, f) => sum + Number(f.quantity), 0);
        console.log(`  fulfilment: ${fulfilledQty} piece(s) newly posted; skipped: ${result.skipped.map((s) => s.reason).join("; ") || "none"}`);
      } catch (err) {
        console.log(`  fulfilment: FAILED — ${err instanceof Error ? err.message : err}`);
      }
    }

    if (order.paymentReceivedAmount && order.paymentReceivedAmount.greaterThan(0)) {
      // getOrderPaymentSummary prefers the manual paymentReceivedAmount, so
      // "already received" there can only be the manual figure itself, not a
      // real receipt — check directly whether any real allocation exists yet.
      const existingAllocations = await prisma.paymentAllocation.findMany({ where: { orderId: order.id } });
      if (existingAllocations.length > 0) {
        console.log(`  payment: already has ${existingAllocations.length} real allocation(s) — skipping`);
      } else {
        const amount = order.paymentReceivedAmount;
        const rate = await lockExchangeRate({ fromCurrencyId: pkr.id, toCurrencyId: pkr.id, rate: 1, source: "backfill-order-ledger migration" });
        const receipt = await recordCustomerReceipt({
          customerId: order.customerId,
          currencyId: pkr.id,
          amount,
          receivedAt: order.createdAt,
          destinationAccountId: defaultAccount.id,
          bankReference: `Backfill for ${order.orderNumber} — originally recorded via quick popup, real account unknown, posted to ${defaultAccount.label}`,
          exchangeRateSnapshotId: rate.id,
          allocations: [{ orderId: order.id, amount }],
        });
        await postCustomerReceipt(receipt.id);
        // Clear the manual override so getOrderPaymentSummary now reads the
        // real allocation instead (no double-counting if this runs again).
        await prisma.salesOrder.update({ where: { id: order.id }, data: { paymentReceivedAmount: null } });
        console.log(`  payment: posted a real receipt for ${amount.toString()} into ${defaultAccount.label}`);
      }
      void summary;
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
