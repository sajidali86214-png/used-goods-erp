import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import { createPurchaseOrder, approvePurchaseOrder } from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";
import {
  createSupplierInvoice,
  approveSupplierInvoice,
  disputeSupplierInvoice,
} from "../src/modules/purchasing/supplierInvoiceService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

async function setUpInvoice(user: { id: string }, product: { id: string }, currency: { id: string }) {
  const supplier = await prisma.supplier.create({
    data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
  });
  const po = await createPurchaseOrder({
    supplierId: supplier.id,
    currencyId: currency.id,
    lines: [{ productId: product.id, orderedQty: 5, unitPrice: 200 }],
  });
  await approvePurchaseOrder(po.id);
  const grn = await createGRN({
    supplierId: supplier.id,
    receiptDate: new Date(),
    receivingUserId: user.id,
    lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 5 }],
  });
  const invoice = await createSupplierInvoice({
    supplierId: supplier.id,
    poId: po.id,
    currencyId: currency.id,
    invoiceDate: new Date(),
    lines: [{ grnLineId: grn.lines[0]!.id, quantity: 5, unitPrice: 200 }],
    actorUserId: user.id,
  });
  return invoice;
}

describe("supplier invoice approval posts Dr GRNI / Cr Accounts Payable", () => {
  it("approving a pending invoice posts the balanced entries and flips approvalStatus", async () => {
    const { currency, product, user } = await seedReferenceData();
    const invoice = await setUpInvoice(user, product, currency);

    const approved = await approveSupplierInvoice(invoice.id, user.id);
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.approvedByUserId).toBe(user.id);
    expect(approved.approvedAt).not.toBeNull();

    const entries = await prisma.ledgerEntry.findMany({
      where: { relatedDocumentType: "SupplierInvoice", relatedDocumentId: invoice.id },
      include: { account: true },
    });
    expect(entries).toHaveLength(2);
    const grniEntry = entries.find((e) => e.account.code === "GRNI");
    const apEntry = entries.find((e) => e.account.code === "ACCOUNTS_PAYABLE");
    expect(grniEntry!.direction).toBe("debit");
    expect(apEntry!.direction).toBe("credit");
    expect(grniEntry!.amount.toNumber()).toBe(1000); // 5 * 200
    expect(apEntry!.amount.toNumber()).toBe(1000);
  });

  it("rejects approving the same invoice twice", async () => {
    const { currency, product, user } = await seedReferenceData();
    const invoice = await setUpInvoice(user, product, currency);

    await approveSupplierInvoice(invoice.id, user.id);
    await expect(approveSupplierInvoice(invoice.id, user.id)).rejects.toThrow();
  });

  it("rejects approving a disputed invoice", async () => {
    const { currency, product, user } = await seedReferenceData();
    const invoice = await setUpInvoice(user, product, currency);

    await disputeSupplierInvoice(invoice.id, "Pricing discrepancy with supplier", user.id);
    await expect(approveSupplierInvoice(invoice.id, user.id)).rejects.toThrow(/disputed/);
  });
});
