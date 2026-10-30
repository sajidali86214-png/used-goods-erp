import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";
import { gradeTransfer, receiveToInspection, writeOff } from "./stockService.js";

const receiveSchema = z.object({
  grnLineId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  originalCurrencyId: z.string().uuid(),
  sourceUnitPrice: z.number().nonnegative(),
  exchangeRate: z.number().positive(),
  landedFreightTotal: z.number().nonnegative().optional(),
  quantity: z.number().positive(),
  binId: z.string().uuid(),
  lotCode: z.string().min(1),
});

const gradeTransferSchema = z.object({
  sourceCostLayerId: z.string().uuid(),
  splits: z
    .array(
      z.object({
        gradeId: z.string().uuid(),
        binId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
  destinationState: z.string().optional(),
});

const writeOffSchema = z.object({
  costLayerId: z.string().uuid(),
  state: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().min(1),
});

export async function stockRoutes(app: FastifyInstance) {
  app.post(
    "/stock/receive",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const body = receiveSchema.parse(request.body);
      const result = await receiveToInspection({
        ...body,
        actorUserId: request.authUser!.id,
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/stock/grade-transfer",
    { preHandler: requirePermission("stock.grade") },
    async (request, reply) => {
      const body = gradeTransferSchema.parse(request.body);
      const result = await gradeTransfer({
        ...body,
        actorUserId: request.authUser!.id,
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/stock/write-off",
    { preHandler: requirePermission("stock.writeoff") },
    async (request, reply) => {
      const body = writeOffSchema.parse(request.body);
      const result = await writeOff({ ...body, actorUserId: request.authUser!.id });
      return reply.code(201).send(result);
    },
  );

  // cost.view-gated: acceptance test #16 — a picker must get 403 here.
  app.get(
    "/products/:id/cost-layers",
    { preHandler: requirePermission("cost.view") },
    async (request) => {
      const { id } = request.params as { id: string };
      return prisma.costLayer.findMany({
        where: { lot: { productId: id } },
        include: { grade: true, bin: true, lot: true },
      });
    },
  );
}
