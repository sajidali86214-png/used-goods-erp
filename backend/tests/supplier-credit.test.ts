import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { seedReferenceData } from "./helpers.js";
import {
  createPurchaseOrder,
  approvePurchaseOrder,
  recordSupplierAdvance,
  recordSupplierCredit,
  getPurchaseOrderStatus,
  matchInvoiceToAdvance,
} from "../src/modules/purchasing/purchaseOrderService.js";
import { postSupplierCredit, getAccountBalance } from "../src/modules/finance/ledgerService.js";
import { getSupplierBalances, getSupplierStatement } from "../src/modules/reports/reportService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

async function pkrAccount(label: string) {
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  return prisma.account.create({ data: { label, currencyId: pkr.id, kind: "bank" } });
}

describe("supplier credits: money or stock credit a supplier gives back", () => {
  it("posts Dr the receiving account, Cr Supplier Advances, same as a real advance would", async () => {
    const { currency, user } = await seedReferenceData();
    const supplier = await prisma.supplier.create({ data: { name: `Credit-Supplier-${randomUUID()}`, defaultCurrencyId: currency.id } });
    const receivingAccount = await pkrAccount(`Credit-Bank-${randomUUID()}`);
    const balanceBefore = await getAccountBalance(receivingAccount.id);

    const credit = await recordSupplierCredit({
      supplierId: supplier.id,
      currencyId: currency.id,
      amount: 1500,
      receivedAt: new Date(),
      receivingAccountId: receivingAccount.id,
      reason: "Overpayment refund",
    });
    await postSupplierCredit(credit.id, user.id);

    expect((await getAccountBalance(receivingAccount.id)).toNumber()).toBe(balanceBefore.toNumber() + 1500);
    const supplierAdvancesAccount = await prisma.account.findFirstOrThrow({ where: { code: "SUPPLIER_ADVANCES" } });
    const creditEntries = await prisma.ledgerEntry.findMany({ where: { relatedDocumentType: "SupplierCredit", relatedDocumentId: credit.id } });
    expect(creditEntries).toHaveLength(2);
    expect(creditEntries.find((e) => e.accountId === supplierAdvancesAccount.id)?.direction).toBe("credit");
    expect(creditEntries.find((e) => e.accountId === receivingAccount.id)?.direction).toBe("debit");
  });

  it("rejects a non-PKR credit instead of guessing an FX treatment", async () => {
    const { user } = await seedReferenceData();
    const gbp = await prisma.currency.upsert({ where: { code: "GBP" }, update: {}, create: { code: "GBP", symbol: "£" } });
    const supplier = await prisma.supplier.create({ data: { name: `FX-Credit-Supplier-${randomUUID()}`, defaultCurrencyId: gbp.id } });
    const receivingAccount = await prisma.account.create({ data: { label: `FX-Bank-${randomUUID()}`, currencyId: gbp.id, kind: "bank" } });

    const credit = await recordSupplierCredit({
      supplierId: supplier.id,
      currencyId: gbp.id,
      amount: 100,
      receivedAt: new Date(),
      receivingAccountId: receivingAccount.id,
      reason: "Foreign-currency refund",
    });

    await expect(postSupplierCredit(credit.id, user.id)).rejects.toThrow(/non-PKR/);
  });

  it("getPurchaseOrderStatus folds a credit into the unapplied advance alongside a real advance", async () => {
    const { currency, product } = await seedReferenceData();
    const supplier = await prisma.supplier.create({ data: { name: `PO-Credit-Supplier-${randomUUID()}`, defaultCurrencyId: currency.id } });

    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 10, unitPrice: 100 }],
    });
    await approvePurchaseOrder(po.id);

    await recordSupplierAdvance({
      supplierId: supplier.id,
      poId: po.id,
      currencyId: currency.id,
      amount: 1000,
      paidAt: new Date(),
      paymentMethodAccountId: "manual-test-account",
      reference: "ADV-CREDIT-TEST",
    });
    await recordSupplierCredit({
      supplierId: supplier.id,
      poId: po.id,
      currencyId: currency.id,
      amount: 200,
      receivedAt: new Date(),
      receivingAccountId: "manual-test-account",
      reason: "Returned defective pieces",
    });

    const status = await getPurchaseOrderStatus(po.id);
    expect(status.totalAdvance.toNumber()).toBe(1000);
    expect(status.totalCredited.toNumber()).toBe(200);
    expect(status.unappliedAdvance.toNumber()).toBe(1200); // advance + credit, nothing matched yet

    const invoice = await prisma.supplierInvoice.create({
      data: { supplierId: supplier.id, poId: po.id, currencyId: currency.id, amount: 500, invoiceDate: new Date() },
    });
    await matchInvoiceToAdvance({ invoiceId: invoice.id, matchedAmount: 500 });

    const statusAfterMatch = await getPurchaseOrderStatus(po.id);
    expect(statusAfterMatch.unappliedAdvance.toNumber()).toBe(700); // 1000 + 200 - 500
  });

  it("getSupplierBalances and getSupplierStatement include a credit received outside any PO", async () => {
    const { currency } = await seedReferenceData();
    const supplier = await prisma.supplier.create({ data: { name: `Report-Credit-Supplier-${randomUUID()}`, defaultCurrencyId: currency.id } });

    await recordSupplierCredit({
      supplierId: supplier.id,
      currencyId: currency.id,
      amount: 750,
      receivedAt: new Date(),
      receivingAccountId: "manual-test-account",
      reason: "Price adjustment",
    });

    const balances = await getSupplierBalances();
    const line = balances.find((b) => b.supplierId === supplier.id);
    expect(line).toBeDefined();
    expect(line!.unappliedAdvance.toNumber()).toBe(750);

    const statement = await getSupplierStatement(supplier.id);
    const creditLine = statement.lines.find((l) => l.type === "credit_received");
    expect(creditLine).toBeDefined();
    expect(creditLine!.amount.toNumber()).toBe(750);
    expect(creditLine!.runningBalance.toNumber()).toBe(750);
  });
});
