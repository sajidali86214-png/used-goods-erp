import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { generateSequentialNumber } from "../../lib/sequentialNumber.js";

interface CreatePOLineInput {
  productId: string;
  gradeId?: string;
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
          gradeId: l.gradeId,
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

/** Free editing of header fields — only while the PO is still a draft. */
export async function updatePurchaseOrder(
  poId: string,
  params: { expectedReceiptDate?: Date; terms?: string; notes?: string },
) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  if (po.status !== "draft") {
    throw new Error(`Cannot edit a PO with status "${po.status}" — use the amendment flow instead`);
  }
  return prisma.purchaseOrder.update({ where: { id: poId }, data: params });
}

/** Free editing of a line — only while the PO is still a draft (same rule as updatePurchaseOrder). */
export async function updatePurchaseOrderLine(
  lineId: string,
  params: { productId?: string; gradeId?: string | null; orderedQty?: Decimal | number; unitPrice?: Decimal | number; discount?: Decimal | number; additionalCosts?: Decimal | number },
) {
  const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { po: true } });
  if (line.po.status !== "draft") {
    throw new Error(`Cannot edit a line on a PO with status "${line.po.status}" — use the amendment flow instead`);
  }
  return prisma.purchaseOrderLine.update({
    where: { id: lineId },
    data: {
      productId: params.productId,
      gradeId: params.gradeId,
      orderedQty: params.orderedQty !== undefined ? new Decimal(params.orderedQty) : undefined,
      unitPrice: params.unitPrice !== undefined ? new Decimal(params.unitPrice) : undefined,
      discount: params.discount !== undefined ? new Decimal(params.discount) : undefined,
      additionalCosts: params.additionalCosts !== undefined ? new Decimal(params.additionalCosts) : undefined,
    },
  });
}

/**
 * Controlled amendment of an already-approved PO line: requires a reason,
 * always recorded as an audit event (before/after), regardless of the PO's
 * status — this is the ONLY way to change ordered qty/price once approved
 * (never a silent edit), mirroring the sales side's amendGradeRequirement.
 */
export async function amendPurchaseOrderLine(params: {
  lineId: string;
  orderedQty?: Decimal | number;
  unitPrice?: Decimal | number;
  actorUserId: string;
  reason: string;
}) {
  const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: params.lineId } });

  const updated = await prisma.purchaseOrderLine.update({
    where: { id: params.lineId },
    data: {
      orderedQty: params.orderedQty !== undefined ? new Decimal(params.orderedQty) : undefined,
      unitPrice: params.unitPrice !== undefined ? new Decimal(params.unitPrice) : undefined,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorUserId: params.actorUserId,
      action: "amend_purchase_order_line",
      entityType: "PurchaseOrderLine",
      entityId: params.lineId,
      beforeJson: { orderedQty: line.orderedQty.toString(), unitPrice: line.unitPrice.toString() },
      afterJson: { orderedQty: updated.orderedQty.toString(), unitPrice: updated.unitPrice.toString() },
      reason: params.reason,
    },
  });

  return updated;
}

/** Amendment history for a PO's lines — doesn't need audit.view, since purchasing staff (stock.receive) need to see this without full audit-log access. */
export async function getPurchaseOrderAmendments(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  const lineIds = po.lines.map((l) => l.id);
  if (lineIds.length === 0) return [];
  return prisma.auditEvent.findMany({
    where: { entityType: "PurchaseOrderLine", entityId: { in: lineIds } },
    orderBy: { createdAt: "desc" },
  });
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
      gradeId: line.gradeId,
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
