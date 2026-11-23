import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { runSerializable } from "../../lib/transaction.js";
import { postSupplierInvoiceApproval } from "../finance/ledgerService.js";

interface CreateInvoiceLineInput {
  grnLineId: string;
  quantity: Decimal | number;
  unitPrice: Decimal | number;
}

// Small absolute tolerance, not a percentage — this is the three-way match's
// only judgment call, and an exact-equality check would flag harmless
// rounding as a variance on every single invoice.
const VARIANCE_TOLERANCE = new Decimal("0.01");

/**
 * Three-way match: each line must trace to a specific received GRN line
 * (what actually arrived), optionally compared against that GRN line's own
 * PO line (what was ordered, if any — a direct receipt has none). A mismatch
 * in quantity or price never blocks creation — it just flags `hasVariance`
 * and records why on the line, so the invoice can still be entered and held
 * for a more deliberate approval (spec section 4).
 */
export async function createSupplierInvoice(params: {
  supplierId: string;
  poId?: string;
  currencyId: string;
  invoiceDate: Date;
  dueDate?: Date;
  lines: CreateInvoiceLineInput[];
  actorUserId: string;
}) {
  return runSerializable(async (tx) => {
    let hasVariance = false;
    const lineData = [];

    for (const line of params.lines) {
      const grnLine = await tx.gRNLine.findUniqueOrThrow({
        where: { id: line.grnLineId },
        include: { poLine: true },
      });
      const quantity = new Decimal(line.quantity);
      const unitPrice = new Decimal(line.unitPrice);
      const amount = quantity.times(unitPrice);

      const mismatches: string[] = [];
      if (quantity.minus(grnLine.receivedQty).abs().greaterThan(VARIANCE_TOLERANCE)) {
        mismatches.push(`Invoiced quantity ${quantity.toString()} differs from received quantity ${grnLine.receivedQty.toString()}`);
      }
      if (grnLine.poLine && unitPrice.minus(grnLine.poLine.unitPrice).abs().greaterThan(VARIANCE_TOLERANCE)) {
        mismatches.push(`Invoiced unit price ${unitPrice.toString()} differs from PO unit price ${grnLine.poLine.unitPrice.toString()}`);
      }
      if (mismatches.length > 0) hasVariance = true;

      lineData.push({
        grnLineId: line.grnLineId,
        quantity,
        unitPrice,
        amount,
        varianceNotes: mismatches.length > 0 ? mismatches.join("; ") : undefined,
      });
    }

    const amount = sumDecimal(lineData.map((l) => l.amount));

    return tx.supplierInvoice.create({
      data: {
        supplierId: params.supplierId,
        poId: params.poId,
        currencyId: params.currencyId,
        amount,
        invoiceDate: params.invoiceDate,
        dueDate: params.dueDate,
        hasVariance,
        lines: { create: lineData },
      },
      include: { lines: true },
    });
  });
}

/**
 * Converts the receipt-time GRNI liability into real Accounts Payable
 * (ledgerService.ts's postSupplierInvoiceApproval). A disputed invoice must
 * be cleared of its dispute first — approving it would recognize a payable
 * for an amount the business has already flagged as wrong.
 */
export async function approveSupplierInvoice(invoiceId: string, actorUserId: string) {
  const invoice = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.approvalStatus !== "pending_approval") {
    throw new Error(`Cannot approve an invoice with approvalStatus "${invoice.approvalStatus}"`);
  }
  if (invoice.isDisputed) {
    throw new Error("Cannot approve a disputed invoice — resolve the dispute first");
  }

  await postSupplierInvoiceApproval(invoice.id, actorUserId);

  return prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: { approvalStatus: "approved", approvedByUserId: actorUserId, approvedAt: new Date() },
  });
}

/** Blocks approval until cleared — there's no "un-dispute" route yet since nothing has asked for one. */
export async function disputeSupplierInvoice(invoiceId: string, reason: string, actorUserId: string) {
  return runSerializable(async (tx) => {
    const invoice = await tx.supplierInvoice.update({
      where: { id: invoiceId },
      data: { isDisputed: true },
    });

    await tx.auditEvent.create({
      data: {
        entityType: "SupplierInvoice",
        entityId: invoice.id,
        action: "dispute_invoice",
        actorUserId,
        reason,
      },
    });

    return invoice;
  });
}

/** Feeds the "new invoice" form: the GRN lines on this PO that no invoice line has been raised against yet. */
export async function getUninvoicedGrnLines(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  const poLineIds = po.lines.map((l) => l.id);
  if (poLineIds.length === 0) return [];

  const grnLines = await prisma.gRNLine.findMany({
    where: { poLineId: { in: poLineIds } },
    include: { product: true, grade: true, poLine: true, invoiceLines: true },
    orderBy: { id: "asc" },
  });

  return grnLines.filter((g) => g.invoiceLines.length === 0);
}
