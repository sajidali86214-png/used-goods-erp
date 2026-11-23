import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import { createPurchaseOrder, approvePurchaseOrder } from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";
import { receiveToInspection } from "../src/modules/stock/stockService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GRNI posts at GRN receipt time", () => {
  it("receiving stock against a GRN line posts Dr Inventory / Cr GRNI for the landed cost", async () => {
    const { currency, bin, product, user } = await seedReferenceData();

    const supplier = await prisma.supplier.create({
      data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
    });

    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 10, unitPrice: 500 }],
    });
    await approvePurchaseOrder(po.id);

    const grn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 10 }],
    });
    const grnLine = grn.lines[0]!;

    await receiveToInspection({
      grnLineId: grnLine.id,
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 500,
      exchangeRate: 1,
      quantity: 10,
      binId: bin.id,
      lotCode: `LOT-${randomUUID()}`,
      actorUserId: user.id,
    });

    const entries = await prisma.ledgerEntry.findMany({
      where: { relatedDocumentType: "GRNLine", relatedDocumentId: grnLine.id },
      include: { account: true },
    });
    expect(entries).toHaveLength(2);

    const inventoryEntry = entries.find((e) => e.account.code === "INVENTORY");
    const grniEntry = entries.find((e) => e.account.code === "GRNI");
    expect(inventoryEntry).toBeDefined();
    expect(grniEntry).toBeDefined();
    expect(inventoryEntry!.direction).toBe("debit");
    expect(grniEntry!.direction).toBe("credit");
    expect(inventoryEntry!.amount.toNumber()).toBe(5000); // 10 * 500 landed unit cost
    expect(grniEntry!.amount.toNumber()).toBe(5000);
  });

  it("an opening-stock receipt (no grnLineId) posts nothing to GRNI", async () => {
    const { currency, bin, product, user } = await seedReferenceData();

    const { lot } = await receiveToInspection({
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 300,
      exchangeRate: 1,
      quantity: 5,
      binId: bin.id,
      lotCode: `LOT-${randomUUID()}`,
      actorUserId: user.id,
    });

    const entries = await prisma.ledgerEntry.findMany({
      where: { relatedDocumentType: "GRNLine", relatedDocumentId: lot.id },
    });
    expect(entries).toHaveLength(0);
  });
});
