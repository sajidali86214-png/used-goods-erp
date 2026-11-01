import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { commitProductImport } from "./importService.js";

const productRowSchema = z.object({
  skuCode: z.string(),
  name: z.string(),
  categoryId: z.string(),
  unitOfMeasure: z.string().optional(),
  description: z.string().optional(),
  defaultSellPrice: z.number().optional(),
  minPrice: z.number().optional(),
});

const importProductsSchema = z.object({
  fileRef: z.string().min(1),
  allOrNothing: z.boolean().optional(),
  rows: z.array(productRowSchema).min(1),
});

export async function importRoutes(app: FastifyInstance) {
  app.post(
    "/imports/products",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = importProductsSchema.parse(request.body);
      const job = await commitProductImport(body);
      return reply.code(job.status === "failed" ? 422 : 201).send(job);
    },
  );
}
