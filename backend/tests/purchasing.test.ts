import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import {
  createPurchaseOrder,
  approvePurchaseOrder,
  recordSupplierAdvance,
  getPurchaseOrderStatus,
  matchInvoiceToAdvance,
} from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #3: partial receipt of a prepaid PO", () => {
  it("shows remaining expected stock and unapplied advance without recording the payment twice", async () => {
    const { currency, product, user } = await seedReferenceData();

    const supplier = await prisma.supplier.create({
      data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
    });

    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 100, unitPrice: 50 }],
    });
    await approvePurchaseOrder(po.id);

    // Full prepayment before any stock arrives.
    const advance = await recordSupplierAdvance({
      supplierId: supplier.id,
      poId: po.id,
      currencyId: currency.id,
      amount: 5000,
      paidAt: new Date(),
      paymentMethodAccountId: "manual-test-account",
      reference: "ADV-1",
    });

    // Only 60 of the 100 ordered pieces actually arrive.
    const grn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 60 }],
    });
    expect(grn.lines[0]!.receivedQty.toNumber()).toBe(60);

    const status = await getPurchaseOrderStatus(po.id);
    expect(status.lines[0]!.receivedQty.toNumber()).toBe(60);
    expect(status.lines[0]!.outstandingQty.toNumber()).toBe(40); // remaining expected stock
    expect(status.totalAdvance.toNumber()).toBe(5000);
    expect(status.unappliedAdvance.toNumber()).toBe(5000); // not re-recorded, not yet matched to an invoice

    // Exactly one advance payment exists for this PO â€” receiving stock never created another.
    const advancesForPO = await prisma.supplierAdvance.findMany({ where: { poId: po.id } });
    expect(advancesForPO).toHaveLength(1);
    expect(advancesForPO[0]!.id).toBe(advance.id);

    // The actual supplier invoice arrives later and gets matched against the advance.
    const invoice = await prisma.supplierInvoice.create({
      data: {
        supplierId: supplier.id,
        poId: po.id,
        currencyId: currency.id,
        amount: 3000, // invoicing for the 60 pieces received so far, at 50 each
        invoiceDate: new Date(),
      },
    });
    const matched = await matchInvoiceToAdvance({ invoiceId: invoice.id, matchedAmount: 3000 });
    expect(matched.status).toBe("matched");

    const statusAfterMatch = await getPurchaseOrderStatus(po.id);
    expect(statusAfterMatch.totalMatchedAgainstInvoices.toNumber()).toBe(3000);
    expect(statusAfterMatch.unappliedAdvance.toNumber()).toBe(2000); // 5000 advance - 3000 matched

    // Receiving the rest later must still respect the ordered quantity.
    await expect(
      createGRN({
        supplierId: supplier.id,
        receiptDate: new Date(),
        receivingUserId: user.id,
        lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 41 }], // only 40 left outstanding
      }),
    ).rejects.toThrow(/exceed the ordered quantity/);

    const finalGrn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 40 }],
    });
    expect(finalGrn.lines[0]!.receivedQty.toNumber()).toBe(40);

    const finalStatus = await getPurchaseOrderStatus(po.id);
    expect(finalStatus.lines[0]!.receivedQty.toNumber()).toBe(100);
    expect(finalStatus.lines[0]!.outstandingQty.toNumber()).toBe(0);
  });
});
