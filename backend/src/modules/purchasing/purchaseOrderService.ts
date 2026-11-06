import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { generateSequentialNumber } from "../../lib/sequentialNumber.js";

interface CreatePOLineInput {
  productId: string;
  orderedQty: Decimal | number;
  unitPrice: Decimal | number;
  discount?: Decimal | number;
  additionalCosts?: Decimal | number;
}

export async function generatePoNumber(): Promise<string> {
  return generateSequentialNumber({
    prefix: "PO",
    countExisting: () => prisma.purchaseOrder.count(),
    exists: async (candidate) => !!(await prisma.purchaseOrder.findUnique({ where: { poNumber: candidate } })),
  });
}

/** poNumber is always assigned automatically — never typed by hand. */
export async function createPurchaseOrder(params: {
  supplierId: string;
  currencyId: string;
  expectedReceiptDate?: Date;
  terms?: string;
  notes?: string;
  lines: CreatePOLineInput[];
}) {
  const poNumber = await generatePoNumber();
  return prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: params.supplierId,
      currencyId: params.currencyId,
      expectedReceiptDate: params.expectedReceiptDate,
      terms: params.terms,
      notes: params.notes,
      status: "draft",
      lines: {
        create: params.lines.map((l) => ({
          productId: l.productId,
          orderedQty: new Decimal(l.orderedQty),
          unitPrice: new Decimal(l.unitPrice),
          discount: l.discount !== undefined ? new Decimal(l.discount) : undefined,
          additionalCosts: l.additionalCosts !== undefined ? new Decimal(l.additionalCosts) : undefined,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function approvePurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  if (po.status !== "draft") {
    throw new Error(`Cannot approve a PO with status "${po.status}"`);
  }
  return prisma.purchaseOrder.update({ where: { id: poId }, data: { status: "approved" } });
}

/**
 * Records a prepayment against the supplier/PO. This is the ONLY place a
 * cash advance is ever recorded — GRN creation never touches this table,
 * so receiving part of a prepaid PO can never double-record the payment
 * (spec section 6.2, acceptance test #3).
 */
export async function recordSupplierAdvance(params: {
  supplierId: string;
  poId?: string;
  currencyId: string;
  amount: Decimal | number;
  paidAt: Date;
  paymentMethodAccountId: string;
  reference?: string;
}) {
  return prisma.supplierAdvance.create({
    data: {
      supplierId: params.supplierId,
      poId: params.poId,
      currencyId: params.currencyId,
      amount: new Decimal(params.amount),
      paidAt: params.paidAt,
      paymentMethodAccountId: params.paymentMethodAccountId,
      reference: params.reference,
      status: "open",
    },
  });
}

/**
 * Full reconciliation view for a PO: ordered vs. received vs. outstanding
 * per line, and how much of any advance payment is still unapplied (not
 * yet matched to a supplier invoice). Supports partial/multiple receipts
 * cleanly since received quantity is always summed fresh from GRNLine, never
 * stored redundantly on the PO line (spec section 6.2/6.3).
 */
export async function getPurchaseOrderStatus(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { lines: true },
  });

  const lines = [];
  for (const line of po.lines) {
    const grnLines = await prisma.gRNLine.findMany({ where: { poLineId: line.id } });
    const receivedQty = sumDecimal(grnLines.map((g) => g.receivedQty));
    const rejectedQty = sumDecimal(grnLines.map((g) => g.rejectedQty));
    lines.push({
      lineId: line.id,
      productId: line.productId,
      orderedQty: line.orderedQty,
      receivedQty,
      rejectedQty,
      outstandingQty: line.orderedQty.minus(receivedQty),
    });
  }

  const advances = await prisma.supplierAdvance.findMany({ where: { poId } });
  const invoices = await prisma.supplierInvoice.findMany({ where: { poId } });
  const totalAdvance = sumDecimal(advances.map((a) => a.amount));
  const totalMatchedAgainstInvoices = sumDecimal(invoices.map((i) => i.matchedAdvance));
  const unappliedAdvance = totalAdvance.minus(totalMatchedAgainstInvoices);

  return {
    poId: po.id,
    status: po.status,
    lines,
    totalAdvance,
    totalMatchedAgainstInvoices,
    unappliedAdvance,
  };
}

/** Matches a supplier invoice against previously-recorded advances, without creating a new payment. */
export async function matchInvoiceToAdvance(params: {
  invoiceId: string;
  matchedAmount: Decimal | number;
}) {
  const invoice = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: params.invoiceId } });
  const matchedAmount = new Decimal(params.matchedAmount);
  const newMatched = invoice.matchedAdvance.plus(matchedAmount);
  if (newMatched.greaterThan(invoice.amount)) {
    throw new Error("Matched advance cannot exceed the invoice amount");
  }
  return prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: {
      matchedAdvance: newMatched,
      status: newMatched.equals(invoice.amount) ? "matched" : "partially_matched",
    },
  });
}
