import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import { createPurchaseOrder, approvePurchaseOrder } from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";
import { createSupplierInvoice } from "../src/modules/purchasing/supplierInvoiceService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("three-way match (PO vs GRN vs invoice)", () => {
  it("never blocks creation — flags hasVariance only when quantity or price actually differ", async () => {
    const { currency, product, user } = await seedReferenceData();

    const supplier = await prisma.supplier.create({
      data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
    });

    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 20, unitPrice: 100 }],
    });
    await approvePurchaseOrder(po.id);

    const grn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 20 }],
    });
    const grnLine = grn.lines[0]!;

    const matchingInvoice = await createSupplierInvoice({
      supplierId: supplier.id,
      poId: po.id,
      currencyId: currency.id,
      invoiceDate: new Date(),
      lines: [{ grnLineId: grnLine.id, quantity: 20, unitPrice: 100 }],
      actorUserId: user.id,
    });
    expect(matchingInvoice.hasVariance).toBe(false);
    expect(matchingInvoice.amount.toNumber()).toBe(2000);
    expect(matchingInvoice.lines[0]!.varianceNotes).toBeNull();

    // A second PO/GRN so the mismatched invoice has its own untouched GRN line to invoice against.
    const po2 = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 20, unitPrice: 100 }],
    });
    await approvePurchaseOrder(po2.id);
    const grn2 = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po2.lines[0]!.id, productId: product.id, receivedQty: 20 }],
    });
    const grnLine2 = grn2.lines[0]!;

    const mismatchedInvoice = await createSupplierInvoice({
      supplierId: supplier.id,
      poId: po2.id,
      currencyId: currency.id,
      invoiceDate: new Date(),
      lines: [{ grnLineId: grnLine2.id, quantity: 18, unitPrice: 110 }], // deliberately differs from received qty/PO price
      actorUserId: user.id,
    });
    expect(mismatchedInvoice.hasVariance).toBe(true);
    expect(mismatchedInvoice.lines[0]!.varianceNotes).not.toBeNull();
  });
});
