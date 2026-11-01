import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { amendGradeRequirement, confirmOrder, createDraftOrder } from "./salesOrderService.js";
import { reserveStock, releaseReservation, suggestAllocation } from "./reservationService.js";
import { pickFromReservation } from "./pickingService.js";
import { computeLineProfitability } from "./profitabilityService.js";

const createOrderSchema = z.object({
  orderNumber: z.string().min(1),
  channelId: z.string().uuid(),
  customerId: z.string().uuid(),
  currencyId: z.string().uuid(),
  salespersonUserId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive(),
        gradeRequirementType: z.enum(["none", "allowed_set", "exact_composition"]).optional(),
        allowedGradeIds: z.array(z.string().uuid()).optional(),
        exactGradeQuantities: z.record(z.string(), z.number()).optional(),
        unitPrice: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
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

export async function salesRoutes(app: FastifyInstance) {
  app.post(
    "/sales/orders",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const body = createOrderSchema.parse(request.body);
      const order = await createDraftOrder(body);
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
}
