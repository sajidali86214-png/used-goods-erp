import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import {
  amendGradeRequirement,
  confirmOrder,
  createDraftOrder,
  computeOrderCostSummary,
  getOrderPaymentSummary,
  updateOrder,
  updateOrderLine,
  updateOrderStatus,
} from "./salesOrderService.js";
import { reserveStock, releaseReservation, suggestAllocation } from "./reservationService.js";
import { pickFromReservation } from "./pickingService.js";
import { computeLineProfitability } from "./profitabilityService.js";
import { dispatchPickAllocation } from "./dispatchService.js";
import { cancelReservedOrPickedQuantity } from "./cancellationService.js";
import { createReturnRequest, receiveReturnLine, inspectReturnLine } from "./returnService.js";
import { createRefund, markRefundPaid } from "./refundService.js";
import { recordSalesOrderPayment } from "../finance/paymentService.js";
import { prisma } from "../../lib/prisma.js";

const createOrderSchema = z.object({
  channelId: z.string().uuid(),
  externalOrderId: z.string().optional(),
  customerId: z.string().uuid(),
  currencyId: z.string().uuid(),
  salespersonUserId: z.string().uuid().optional(),
  shippingPerUnit: z.number().nonnegative().optional(),
  commissionType: z.enum(["percentage", "fixed"]).optional(),
  commissionValue: z.number().nonnegative().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive(),
        gradeRequirementType: z.enum(["none", "allowed_set", "exact_composition"]).optional(),
        allowedGradeIds: z.array(z.string().uuid()).optional(),
        exactGradeQuantities: z.record(z.string(), z.number()).optional(),
        unitPrice: z.number().nonnegative().optional(),
        priceOverrideReason: z.string().optional(),
        discountType: z.enum(["percentage", "fixed"]).optional(),
        discountValue: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

const updateOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  externalOrderId: z.string().optional(),
  salespersonUserId: z.string().uuid().optional(),
  notes: z.string().optional(),
  shippingPerUnit: z.number().nonnegative().optional(),
  commissionType: z.enum(["percentage", "fixed"]).nullable().optional(),
  commissionValue: z.number().nonnegative().optional(),
});

const updateOrderStatusSchema = z.object({
  qcStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  paymentStatus: z.enum(["unpaid", "partially_paid", "paid"]).optional(),
  fulfilmentStatus: z.enum([
    "unfulfilled",
    "picking",
    "packed",
    "partially_dispatched",
    "dispatched",
    "partially_delivered",
    "delivered",
    "returned",
    "cancelled",
  ]).optional(),
  paymentReceivedAmount: z.number().nonnegative().optional(),
  returnedQuantity: z.number().nonnegative().optional(),
  refundAmount: z.number().nonnegative().optional(),
  cancellationAmount: z.number().nonnegative().optional(),
});

const updateOrderLineSchema = z.object({
  quantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  discountType: z.enum(["percentage", "fixed"]).nullable().optional(),
  discountValue: z.number().nonnegative().optional(),
  taxesFees: z.number().nonnegative().optional(),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  receivedAt: z.coerce.date(),
  destinationAccountId: z.string().uuid(),
  bankReference: z.string().optional(),
});

const suggestAllocationSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  allowedGradeIds: z.array(z.string().uuid()).optional(),
});

const reserveSchema = z.object({
  orderLineId: z.string().uuid(),
  costLayerId: z.string().uuid(),
  gradeId: z.string().uuid(),
  binId: z.string().uuid(),
  quantity: z.number().positive(),
});

const pickSchema = reserveSchema;

const amendGradeSchema = z.object({
  addAllowedGradeId: z.string().uuid(),
  reason: z.string().min(1),
});

const dispatchSchema = z.object({
  pickAllocationId: z.string().uuid(),
  quantity: z.number().positive(),
  shipmentId: z.string().uuid().optional(),
  courier: z.string().optional(),
  trackingRef: z.string().optional(),
});

const cancelSchema = z.object({
  reservationId: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().min(1),
  feeChargedAmount: z.number().nonnegative().optional(),
  feeBeneficiary: z.string().optional(),
  refundDueAmount: z.number().nonnegative().optional(),
  approvedByUserId: z.string().uuid().optional(),
});

const createReturnRequestSchema = z.object({ orderId: z.string().uuid() });

const receiveReturnLineSchema = z.object({
  returnRequestId: z.string().uuid(),
  orderLineId: z.string().uuid(),
  costLayerId: z.string().uuid(),
  sourcePickAllocationId: z.string().uuid().optional(),
  originGradeId: z.string().uuid(),
  quantity: z.number().positive(),
  originUncertain: z.boolean().optional(),
  assumptionNotes: z.string().optional(),
});

const inspectReturnLineSchema = z.object({
  outcomes: z
    .array(
      z.object({
        inspectedGradeId: z.string().uuid(),
        quantity: z.number().positive(),
        disposition: z.enum(["resaleable", "repair", "damaged"]),
      }),
    )
    .min(1),
});

const createRefundSchema = z.object({
  orderId: z.string().uuid(),
  returnRequestId: z.string().uuid().optional(),
  amount: z.number().positive(),
  currencyId: z.string().uuid(),
});

const markRefundPaidSchema = z.object({ paymentMethodAccountId: z.string().min(1) });

export async function salesRoutes(app: FastifyInstance) {
  app.get(
    "/sales/orders",
    { preHandler: requirePermission("order.create") },
    async () => {
      const orders = await prisma.salesOrder.findMany({
        include: { customer: true, lines: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return orders.map((order) => ({ ...order, costSummary: computeOrderCostSummary(order) }));
    },
  );

  app.get(
    "/sales/orders/:id",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const order = await prisma.salesOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          lines: { include: { product: true, reservations: true, pickAllocations: true } },
          shipments: { include: { lines: true } },
          returnRequests: true,
          refunds: true,
        },
      });
      if (!order) return reply.code(404).send({ error: "not_found" });
      return { ...order, costSummary: computeOrderCostSummary(order) };
    },
  );

  app.get(
    "/sales/returns",
    { preHandler: requirePermission("return.process") },
    async () =>
      prisma.returnRequest.findMany({
        include: { order: { include: { customer: true } }, lines: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
  );

  app.post(
    "/sales/orders",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const body = createOrderSchema.parse(request.body);
      const order = await createDraftOrder({
        ...body,
        actorUserId: request.authUser!.id,
        actorHasPriceOverride: request.authUser!.permissions.has("price.override"),
      });
      return reply.code(201).send(order);
    },
  );

  app.post(
    "/sales/orders/:id/confirm",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const order = await confirmOrder(id);
      return reply.send(order);
    },
  );

  // Editable until payment is received — updateOrder/updateOrderLine both
  // reject once paymentStatus has left "unpaid".
  app.patch(
    "/sales/orders/:id",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateOrderSchema.parse(request.body);
      const order = await updateOrder(id, body);
      return reply.send({ ...order, costSummary: computeOrderCostSummary(order) });
    },
  );

  app.patch(
    "/sales/order-lines/:id",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateOrderLineSchema.parse(request.body);
      const line = await updateOrderLine(id, body);
      return reply.send(line);
    },
  );

  app.get(
    "/sales/orders/:id/payment-summary",
    { preHandler: requirePermission("order.create") },
    async (request) => {
      const { id } = request.params as { id: string };
      return getOrderPaymentSummary(id);
    },
  );

  // One-step payment: creates + posts the customer receipt and syncs the
  // order's paymentStatus label in a single call — no separate visit to
  // Customer Receipts needed. Gated on finance.payment alone (not
  // order.create) since this is squarely a finance action.
  app.post(
    "/sales/orders/:id/record-payment",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = recordPaymentSchema.parse(request.body);
      try {
        const result = await recordSalesOrderPayment({ orderId: id, ...body });
        return reply.code(201).send(result);
      } catch (err) {
        // An overpayment/duplicate-entry attempt is a client mistake, not a
        // server fault — surface the real reason instead of a bare 500.
        return reply.code(400).send({ error: err instanceof Error ? err.message : "could_not_record_payment" });
      }
    },
  );

  // Manual status labels — always available regardless of payment status,
  // unlike updateOrder/updateOrderLine above (no transition rules enforced).
  app.patch(
    "/sales/orders/:id/status",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = updateOrderStatusSchema.parse(request.body);
      const order = await updateOrderStatus(id, body);
      return reply.send(order);
    },
  );

  app.post(
    "/sales/allocations/suggest",
    { preHandler: requirePermission("order.create") },
    async (request) => {
      const body = suggestAllocationSchema.parse(request.body);
      return suggestAllocation(body);
    },
  );

  app.post(
    "/sales/reservations",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const body = reserveSchema.parse(request.body);
      const reservation = await reserveStock(body);
      return reply.code(201).send(reservation);
    },
  );

  app.post(
    "/sales/reservations/:id/release",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reservation = await releaseReservation(id);
      return reply.send(reservation);
    },
  );

  app.post("/sales/picks", { preHandler: requirePermission("order.pick") }, async (request, reply) => {
    const body = pickSchema.parse(request.body);
    const pick = await pickFromReservation({ ...body, pickerUserId: request.authUser!.id });
    return reply.code(201).send(pick);
  });

  app.post(
    "/sales/order-lines/:id/amend-grade",
    { preHandler: requirePermission("order.grade_amend") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = amendGradeSchema.parse(request.body);
      const line = await amendGradeRequirement({
        orderLineId: id,
        ...body,
        actorUserId: request.authUser!.id,
      });
      return reply.send(line);
    },
  );

  // profit.view-gated: a picker must not see cost/profit data even for an order they picked.
  app.get(
    "/sales/order-lines/:id/profitability",
    { preHandler: requirePermission("profit.view") },
    async (request) => {
      const { id } = request.params as { id: string };
      return computeLineProfitability(id);
    },
  );

  app.post(
    "/sales/dispatches",
    { preHandler: requirePermission("order.dispatch") },
    async (request, reply) => {
      const body = dispatchSchema.parse(request.body);
      const result = await dispatchPickAllocation({ ...body, actorUserId: request.authUser!.id });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/sales/cancellations",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const body = cancelSchema.parse(request.body);
      const result = await cancelReservedOrPickedQuantity({ ...body, actorUserId: request.authUser!.id });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/sales/returns",
    { preHandler: requirePermission("return.process") },
    async (request, reply) => {
      const body = createReturnRequestSchema.parse(request.body);
      const returnRequest = await createReturnRequest({ ...body, requestedByUserId: request.authUser!.id });
      return reply.code(201).send(returnRequest);
    },
  );

  app.post(
    "/sales/returns/lines",
    { preHandler: requirePermission("return.process") },
    async (request, reply) => {
      const body = receiveReturnLineSchema.parse(request.body);
      const returnLine = await receiveReturnLine({ ...body, actorUserId: request.authUser!.id });
      return reply.code(201).send(returnLine);
    },
  );

  app.post(
    "/sales/returns/lines/:id/inspect",
    { preHandler: requirePermission("return.process") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = inspectReturnLineSchema.parse(request.body);
      const result = await inspectReturnLine({
        returnLineId: id,
        outcomes: body.outcomes,
        actorUserId: request.authUser!.id,
      });
      return reply.send(result);
    },
  );

  app.post(
    "/sales/refunds",
    { preHandler: requirePermission("refund.create") },
    async (request, reply) => {
      const body = createRefundSchema.parse(request.body);
      const refund = await createRefund(body);
      return reply.code(201).send(refund);
    },
  );

  // Marking a refund actually paid is the disbursement step, gated separately from merely requesting one.
  app.post(
    "/sales/refunds/:id/mark-paid",
    { preHandler: requirePermission("refund.approve") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = markRefundPaidSchema.parse(request.body);
      const refund = await markRefundPaid(id, body.paymentMethodAccountId);
      return reply.send(refund);
    },
  );
}
