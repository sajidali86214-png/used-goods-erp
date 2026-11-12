import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import {
  createPurchaseOrder,
  approvePurchaseOrder,
  recordSupplierAdvance,
  getPurchaseOrderStatus,
  matchInvoiceToAdvance,
  updatePurchaseOrder,
  updatePurchaseOrderLine,
  amendPurchaseOrderLine,
  getPurchaseOrderAmendments,
} from "./purchaseOrderService.js";
import { createGRN } from "./grnService.js";
import { renderPurchaseOrderPdf } from "./poDocumentService.js";
import { prisma } from "../../lib/prisma.js";

const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  currencyId: z.string().uuid(),
  expectedReceiptDate: z.coerce.date().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        gradeId: z.string().uuid().optional(),
        orderedQty: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        discount: z.number().nonnegative().optional(),
        additionalCosts: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

const advanceSchema = z.object({
  supplierId: z.string().uuid(),
  poId: z.string().uuid().optional(),
  currencyId: z.string().uuid(),
  amount: z.number().positive(),
  paidAt: z.coerce.date(),
  paymentMethodAccountId: z.string().min(1),
  reference: z.string().optional(),
});

const createGRNSchema = z.object({
  supplierId: z.string().uuid(),
  receiptDate: z.coerce.date(),
  deliveryReference: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        poLineId: z.string().uuid().optional(),
        productId: z.string().uuid(),
        gradeId: z.string().uuid().optional(),
        receivedQty: z.number().positive(),
        rejectedQty: z.number().nonnegative().optional(),
        inspectionNotes: z.string().optional(),
      }),
    )
    .min(1),
});

const matchInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  matchedAmount: z.number().positive(),
});

const updatePOSchema = z.object({
  expectedReceiptDate: z.coerce.date().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
});

const updatePOLineSchema = z.object({
  productId: z.string().uuid().optional(),
  gradeId: z.string().uuid().nullable().optional(),
  orderedQty: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  additionalCosts: z.number().nonnegative().optional(),
});

const amendPOLineSchema = z.object({
  orderedQty: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  reason: z.string().min(1),
});

export async function purchasingRoutes(app: FastifyInstance) {
  app.get(
    "/purchasing/orders",
    { preHandler: requirePermission("stock.receive") },
    async () =>
      prisma.purchaseOrder.findMany({
        include: { supplier: true, lines: { include: { grade: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
  );

  app.get(
    "/purchasing/orders/:id",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: { supplier: true, lines: { include: { product: true, grade: true } } },
      });
      if (!po) return reply.code(404).send({ error: "not_found" });
      return po;
    },
  );

  app.get(
    "/purchasing/grns",
    { preHandler: requirePermission("stock.receive") },
    async () => prisma.gRN.findMany({ include: { supplier: true, lines: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  );

  app.get(
    "/purchasing/grns/:id",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const grn = await prisma.gRN.findUnique({
        where: { id },
        include: {
          supplier: true,
          lines: {
            include: {
              product: true,
              grade: true,
              poLine: { include: { po: true } },
              lots: { include: { costLayers: { include: { grade: true }, where: { quantityRemaining: { gt: 0 } } } } },
            },
          },
        },
      });
      if (!grn) return reply.code(404).send({ error: "not_found" });
      return grn;
    },
  );

  app.post(
    "/purchasing/orders",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const body = createPOSchema.parse(request.body);
      const po = await createPurchaseOrder(body);
      return reply.code(201).send(po);
    },
  );

  app.get(
    "/purchasing/orders/:id/pdf",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.findUnique({ where: { id } });
      if (!po) return reply.code(404).send({ error: "not_found" });
      const pdf = await renderPurchaseOrderPdf(id);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${po.poNumber}.pdf"`)
        .send(pdf);
    },
  );

  app.post(
    "/purchasing/orders/:id/approve",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const po = await approvePurchaseOrder(id);
      return reply.send(po);
    },
  );

  app.get(
    "/purchasing/orders/:id/status",
    { preHandler: requirePermission("stock.receive") },
    async (request) => {
      const { id } = request.params as { id: string };
      return getPurchaseOrderStatus(id);
    },
  );

  app.patch(
    "/purchasing/orders/:id",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updatePOSchema.parse(request.body);
      try {
        return await updatePurchaseOrder(id, body);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "could_not_update" });
      }
    },
  );

  app.patch(
    "/purchasing/orders/:poId/lines/:lineId",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { lineId } = request.params as { poId: string; lineId: string };
      const body = updatePOLineSchema.parse(request.body);
      try {
        return await updatePurchaseOrderLine(lineId, body);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "could_not_update" });
      }
    },
  );

  app.post(
    "/purchasing/orders/:poId/lines/:lineId/amend",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { lineId } = request.params as { poId: string; lineId: string };
      const body = amendPOLineSchema.parse(request.body);
      const line = await amendPurchaseOrderLine({ lineId, ...body, actorUserId: request.authUser!.id });
      return reply.send(line);
    },
  );

  app.get(
    "/purchasing/orders/:id/amendments",
    { preHandler: requirePermission("stock.receive") },
    async (request) => {
      const { id } = request.params as { id: string };
      return getPurchaseOrderAmendments(id);
    },
  );

  app.post(
    "/purchasing/advances",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = advanceSchema.parse(request.body);
      const advance = await recordSupplierAdvance(body);
      return reply.code(201).send(advance);
    },
  );

  app.post(
    "/purchasing/invoices/match",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = matchInvoiceSchema.parse(request.body);
      const invoice = await matchInvoiceToAdvance(body);
      return reply.send(invoice);
    },
  );

  app.post(
    "/purchasing/grns",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const body = createGRNSchema.parse(request.body);
      const grn = await createGRN({ ...body, receivingUserId: request.authUser!.id });
      return reply.code(201).send(grn);
    },
  );
}
