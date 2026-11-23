import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder } from "../src/modules/sales/salesOrderService.js";
import { recordCustomerReceipt } from "../src/modules/finance/paymentService.js";
import { lockExchangeRate } from "../src/modules/finance/currencyService.js";
import { getStockAging, getSupplierBalances, getCustomerBalances, getSupplierStatement } from "../src/modules/reports/reportService.js";
import { createPurchaseOrder, approvePurchaseOrder } from "../src/modules/purchasing/purchaseOrderService.js";
import { createGRN } from "../src/modules/purchasing/grnService.js";
import { createSupplierInvoice, approveSupplierInvoice } from "../src/modules/purchasing/supplierInvoiceService.js";
import { seedReferenceData } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("extra reports: stock aging, supplier balances, customer balances", () => {
  it("getStockAging reports a positive age and the right remaining quantity for a known lot", async () => {
    const { bin, product, currency, gradeByCode, user } = await seedSalesReferenceData();
    await receiveSaleable({ productId: product.id, binId: bin.id, currencyId: currency.id, gradeId: gradeByCode.get("A")!.id, unitPrice: 500, quantity: 7, actorUserId: user.id });

    const aging = await getStockAging();
    const line = aging.find((a) => a.productId === product.id);
    expect(line).toBeDefined();
    expect(line!.quantityRemaining.toNumber()).toBe(7);
    expect(line!.oldestAgeDays).toBeGreaterThanOrEqual(0);
  });

  it("getSupplierBalances reflects an unapplied advance", async () => {
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const supplier = await prisma.supplier.create({ data: { name: `Balance-Supplier-${randomUUID()}`, defaultCurrencyId: pkr.id } });
    await prisma.supplierAdvance.create({
      data: { supplierId: supplier.id, currencyId: pkr.id, amount: 4000, paidAt: new Date(), paymentMethodAccountId: "manual-test" },
    });

    const balances = await getSupplierBalances();
    const line = balances.find((b) => b.supplierId === supplier.id);
    expect(line).toBeDefined();
    expect(line!.totalAdvancesPaid.toNumber()).toBe(4000);
    expect(line!.unappliedAdvance.toNumber()).toBe(4000);
  });

  it("getSupplierBalances and getSupplierStatement surface AP from an approved supplier invoice", async () => {
    const { currency, product, user } = await seedReferenceData();
    const supplier = await prisma.supplier.create({
      data: { name: `AP-Supplier-${randomUUID()}`, defaultCurrencyId: currency.id },
    });

    const po = await createPurchaseOrder({
      supplierId: supplier.id,
      currencyId: currency.id,
      lines: [{ productId: product.id, orderedQty: 4, unitPrice: 150 }],
    });
    await approvePurchaseOrder(po.id);
    const grn = await createGRN({
      supplierId: supplier.id,
      receiptDate: new Date(),
      receivingUserId: user.id,
      lines: [{ poLineId: po.lines[0]!.id, productId: product.id, receivedQty: 4 }],
    });

    const overdueDueDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday — already overdue
    const invoice = await createSupplierInvoice({
      supplierId: supplier.id,
      poId: po.id,
      currencyId: currency.id,
      invoiceDate: new Date(),
      dueDate: overdueDueDate,
      lines: [{ grnLineId: grn.lines[0]!.id, quantity: 4, unitPrice: 150 }],
      actorUserId: user.id,
    });

    // Not yet approved — AP is still zero, but this GRN line is uninvoiced-count-wise already covered.
    const balancesBeforeApproval = await getSupplierBalances();
    const lineBeforeApproval = balancesBeforeApproval.find((b) => b.supplierId === supplier.id);
    expect(lineBeforeApproval?.invoicedUnpaid.toNumber() ?? 0).toBe(0);

    await approveSupplierInvoice(invoice.id, user.id);

    const balances = await getSupplierBalances();
    const line = balances.find((b) => b.supplierId === supplier.id);
    expect(line).toBeDefined();
    expect(line!.invoicedUnpaid.toNumber()).toBe(600); // 4 * 150, Phase 1 has no payment recording yet
    expect(line!.overdueAmount.toNumber()).toBe(600); // dueDate already passed
    expect(line!.uninvoicedCount).toBe(0); // the only GRN line was invoiced

    const statement = await getSupplierStatement(supplier.id);
    const approvalEvent = statement.lines.find((l) => l.type === "invoice_approved");
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.amount.toNumber()).toBe(0); // informational only — no payment path yet
  });

  it("getCustomerBalances reflects booked value minus actual receipts", async () => {
    const { product, currency, channel, customer, user } = await seedSalesReferenceData();

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 2, unitPrice: 1000 }],
    });

    const rate = await lockExchangeRate({ fromCurrencyId: currency.id, toCurrencyId: currency.id, rate: 1, source: "test" });
    const account = await prisma.account.create({ data: { label: `Bal-Bank-${randomUUID()}`, currencyId: currency.id, kind: "bank" } });
    await recordCustomerReceipt({
      currencyId: currency.id,
      amount: 800,
      receivedAt: new Date(),
      destinationAccountId: account.id,
      exchangeRateSnapshotId: rate.id,
      allocations: [{ orderId: order.id, amount: 800 }],
    });

    const balances = await getCustomerBalances();
    const line = balances.find((b) => b.customerId === customer.id);
    expect(line).toBeDefined();
    expect(line!.bookedValue.toNumber()).toBe(2000);
    expect(line!.received.toNumber()).toBe(800);
    expect(line!.outstanding.toNumber()).toBe(1200);
  });
});
