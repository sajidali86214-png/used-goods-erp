import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";
import { generateSequentialNumber } from "../../lib/sequentialNumber.js";

interface GRNLineInput {
  poLineId?: string;
  productId: string;
  gradeId?: string;
  receivedQty: Decimal | number;
  rejectedQty?: Decimal | number;
  inspectionNotes?: string;
}

export async function generateGrnNumber(): Promise<string> {
  return generateSequentialNumber({
    prefix: "GRN",
    countExisting: () => prisma.gRN.count(),
    exists: async (candidate) => !!(await prisma.gRN.findUnique({ where: { grnNumber: candidate } })),
  });
}

/**
 * Records the PHYSICAL receipt document only — explicitly distinct from
 * inspection/acceptance into saleable stock (spec section 6.3). Creating a
 * GRN never touches SupplierAdvance/SupplierPayment, so a partial receipt
 * of a prepaid PO can never re-record the payment (acceptance test #3).
 * Actually placing received quantity into inventory is a separate step —
 * call stockService.receiveToInspection with the resulting GRNLine's id.
 * grnNumber is always assigned automatically — never typed by hand.
 */
export async function createGRN(params: {
  supplierId: string;
  receiptDate: Date;
  deliveryReference?: string;
  receivingUserId: string;
  notes?: string;
  lines: GRNLineInput[];
}) {
  // Support partial/multiple receipts: validate against outstanding ordered
  // quantity (received-so-far, net of this GRN, never exceeds ordered).
  for (const line of params.lines) {
    if (!line.poLineId) continue;
    const poLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.poLineId } });
    const priorGrnLines = await prisma.gRNLine.findMany({ where: { poLineId: line.poLineId } });
    const priorReceived = priorGrnLines.reduce((sum, g) => sum.plus(g.receivedQty), new Decimal(0));
    const thisReceipt = new Decimal(line.receivedQty);
    if (priorReceived.plus(thisReceipt).greaterThan(poLine.orderedQty)) {
      throw new Error(
        `Receiving ${thisReceipt.toString()} would exceed the ordered quantity for PO line ${line.poLineId} (outstanding: ${poLine.orderedQty.minus(priorReceived).toString()})`,
      );
    }
  }

  const grnNumber = await generateGrnNumber();
  return prisma.gRN.create({
    data: {
      grnNumber,
      supplierId: params.supplierId,
      receiptDate: params.receiptDate,
      deliveryReference: params.deliveryReference,
      receivingUserId: params.receivingUserId,
      notes: params.notes,
      lines: {
        create: params.lines.map((l) => ({
          poLineId: l.poLineId,
          productId: l.productId,
          gradeId: l.gradeId,
          receivedQty: new Decimal(l.receivedQty),
          rejectedQty: l.rejectedQty !== undefined ? new Decimal(l.rejectedQty) : undefined,
          inspectionNotes: l.inspectionNotes,
        })),
      },
    },
    include: { lines: true },
  });
}
