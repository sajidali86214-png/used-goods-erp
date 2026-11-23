import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import { createPurchaseOrder, approvePurchaseOrder } from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";
import { receiveToInspection } from "../src/modules/stock/stockService.js";
import { reverseGrnLineReceipt } from "../src/modules/purchasing/grnCorrectionService.js";
import { getAccountBalance } from "../src/modules/finance/ledgerService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reversing a GRN-line receipt counter-posts its GRNI entries", () => {
  it("posts the inverse entries with reversalOfId and nets the account impact to zero", async () => {
    const { currency, bin, product, user } = await seedReferenceData();

    const supplier = await prisma.supplier.create({
      data: { name: `Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
    });
    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 8, unitPrice: 250 }],
    });
    await approvePurchaseOrder(po.id);
    const grn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 8 }],
    });
    const grnLine = grn.lines[0]!;

    await receiveToInspection({
      grnLineId: grnLine.id,
      productId: product.id,
      originalCurrencyId: currency.id,
      sourceUnitPrice: 250,
      exchangeRate: 1,
      quantity: 8,
      binId: bin.id,
      lotCode: `LOT-${randomUUID()}`,
      actorUserId: user.id,
    });

    const inventoryAccount = await prisma.account.findFirstOrThrow({ where: { code: "INVENTORY" } });
    const grniAccount = await prisma.account.findFirstOrThrow({ where: { code: "GRNI" } });
    const inventoryBalanceAfterReceipt = await getAccountBalance(inventoryAccount.id);
    const grniBalanceAfterReceipt = await getAccountBalance(grniAccount.id);

    await reverseGrnLineReceipt({ grnLineId: grnLine.id, reason: "Wrong quantity received", actorUserId: user.id });

    const reversalEntries = await prisma.ledgerEntry.findMany({
      where: { relatedDocumentType: "GRNLine", relatedDocumentId: `${grnLine.id}-reversal` },
    });
    expect(reversalEntries).toHaveLength(2);
    for (const entry of reversalEntries) {
      expect(entry.reversalOfId).not.toBeNull();
    }

    const inventoryBalanceAfterReversal = await getAccountBalance(inventoryAccount.id);
    const grniBalanceAfterReversal = await getAccountBalance(grniAccount.id);
    expect(inventoryBalanceAfterReversal.toNumber()).toBe(
      inventoryBalanceAfterReceipt.toNumber() - 8 * 250,
    );
    expect(grniBalanceAfterReversal.toNumber()).toBe(grniBalanceAfterReceipt.toNumber() - 8 * 250);
  });
});
