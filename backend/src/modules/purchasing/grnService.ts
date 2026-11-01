import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

interface GRNLineInput {
  poLineId?: string;
  productId: string;
  receivedQty: Decimal | number;
  rejectedQty?: Decimal | number;
  inspectionNotes?: string;
}

/**
 * Records the PHYSICAL receipt document only — explicitly distinct from
 * inspection/acceptance into saleable stock (spec section 6.3). Creating a
 * GRN never touches SupplierAdvance/SupplierPayment, so a partial receipt
 * of a prepaid PO can never re-record the payment (acceptance test #3).
 * Actually placing received quantity into inventory is a separate step —
 * call stockService.receiveToInspection with the resulting GRNLine's id.
 */
export async function createGRN(params: {
  grnNumber: string;
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

  return prisma.gRN.create({
    data: {
      grnNumber: params.grnNumber,
      supplierId: params.supplierId,
      receiptDate: params.receiptDate,
      deliveryReference: params.deliveryReference,
      receivingUserId: params.receivingUserId,
      notes: params.notes,
      lines: {
        create: params.lines.map((l) => ({
          poLineId: l.poLineId,
          productId: l.productId,
          receivedQty: new Decimal(l.receivedQty),
          rejectedQty: l.rejectedQty !== undefined ? new Decimal(l.rejectedQty) : undefined,
          inspectionNotes: l.inspectionNotes,
        })),
      },
    },
    include: { lines: true },
  });
}
