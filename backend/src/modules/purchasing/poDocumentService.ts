import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma.js";
import { readStoredFile } from "../media/storage.js";

/**
 * Renders a purchase order as a PDF buffer. If a letterhead image has been
 * uploaded (Settings > Documents), it's embedded across the top of page 1;
 * otherwise a plain text placeholder header is used so the document still
 * works before the owner has supplied their letterhead.
 */
export async function renderPurchaseOrderPdf(poId: string): Promise<Buffer> {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { supplier: true, lines: { include: { product: true, grade: true } } },
  });

  const letterhead = await prisma.appSetting.findUnique({ where: { key: "letterhead_storage_key" } });

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  if (letterhead) {
    try {
      const imageBytes = await readStoredFile(letterhead.value);
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.image(imageBytes, doc.page.margins.left, doc.page.margins.top, { width: pageWidth });
      doc.y = doc.page.margins.top + 90;
    } catch {
      doc.fontSize(18).text("[Your company letterhead]", { align: "center" });
      doc.moveDown();
    }
  } else {
    doc.fontSize(18).text("[Your company letterhead]", { align: "center" });
    doc.fontSize(9).fillColor("#888").text("Upload one in Settings > Documents to replace this placeholder.", { align: "center" });
    doc.fillColor("#000");
    doc.moveDown();
  }

  doc.fontSize(20).text("PURCHASE ORDER", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(11);
  doc.text(`PO Number: ${po.poNumber}`);
  doc.text(`Date: ${po.createdAt.toISOString().slice(0, 10)}`);
  doc.text(`Status: ${po.status}`);
  if (po.expectedReceiptDate) doc.text(`Expected receipt: ${po.expectedReceiptDate.toISOString().slice(0, 10)}`);
  doc.moveDown();

  doc.fontSize(12).text("Supplier", { underline: true });
  doc.fontSize(11).text(po.supplier.name);
  if (po.supplier.contactPerson) doc.text(po.supplier.contactPerson);
  if (po.supplier.phone) doc.text(po.supplier.phone);
  if (po.supplier.address) doc.text(po.supplier.address);
  doc.moveDown();

  const colX = { sku: 50, name: 120, grade: 300, qty: 350, price: 410, total: 480 };
  const tableTop = doc.y;
  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("SKU", colX.sku, tableTop);
  doc.text("Product", colX.name, tableTop);
  doc.text("Grade", colX.grade, tableTop);
  doc.text("Qty", colX.qty, tableTop);
  doc.text("Unit price", colX.price, tableTop);
  doc.text("Line total", colX.total, tableTop);
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
  doc.font("Helvetica");

  let y = tableTop + 22;
  let subtotal = 0;
  for (const line of po.lines) {
    const qty = Number(line.orderedQty);
    const price = Number(line.unitPrice);
    const lineTotal = qty * price;
    subtotal += lineTotal;

    doc.text(line.product.skuCode, colX.sku, y, { width: 65 });
    doc.text(line.product.name, colX.name, y, { width: 175 });
    doc.text(line.grade?.code ?? "—", colX.grade, y, { width: 45 });
    doc.text(String(qty), colX.qty, y, { width: 55 });
    doc.text(price.toLocaleString(), colX.price, y, { width: 65 });
    doc.text(lineTotal.toLocaleString(), colX.total, y, { width: 65 });
    y += 20;
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
  }

  doc.moveTo(50, y + 5).lineTo(545, y + 5).stroke();
  doc.font("Helvetica-Bold").text(`Total: ${subtotal.toLocaleString()}`, colX.total - 60, y + 15);
  doc.font("Helvetica");

  if (po.terms) {
    doc.moveDown(2);
    doc.fontSize(11).text("Terms", { underline: true });
    doc.fontSize(10).text(po.terms);
  }
  if (po.notes) {
    doc.moveDown();
    doc.fontSize(11).text("Notes", { underline: true });
    doc.fontSize(10).text(po.notes);
  }

  doc.end();
  return done;
}
