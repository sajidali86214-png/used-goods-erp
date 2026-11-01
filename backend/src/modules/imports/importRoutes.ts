import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { commitProductImport, commitSupplierImport, commitCustomerImport, commitOpeningStockImport } from "./importService.js";

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

const supplierRowSchema = z.object({
  name: z.string(),
  defaultCurrencyId: z.string(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
});

const importSuppliersSchema = z.object({
  fileRef: z.string().min(1),
  allOrNothing: z.boolean().optional(),
  rows: z.array(supplierRowSchema).min(1),
});

const customerRowSchema = z.object({
  name: z.string(),
  contact: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const importCustomersSchema = z.object({
  fileRef: z.string().min(1),
  allOrNothing: z.boolean().optional(),
  rows: z.array(customerRowSchema).min(1),
});

const openingStockRowSchema = z.object({
  skuCode: z.string(),
  gradeCode: z.string(),
  binCode: z.string(),
  quantity: z.number(),
  unitCost: z.number(),
  currencyId: z.string(),
  costIsEstimated: z.boolean().optional(),
  notes: z.string().optional(),
});

const importOpeningStockSchema = z.object({
  fileRef: z.string().min(1),
  allOrNothing: z.boolean().optional(),
  rows: z.array(openingStockRowSchema).min(1),
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

  app.post(
    "/imports/suppliers",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = importSuppliersSchema.parse(request.body);
      const job = await commitSupplierImport(body);
      return reply.code(job.status === "failed" ? 422 : 201).send(job);
    },
  );

  app.post(
    "/imports/customers",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = importCustomersSchema.parse(request.body);
      const job = await commitCustomerImport(body);
      return reply.code(job.status === "failed" ? 422 : 201).send(job);
    },
  );

  app.post(
    "/imports/opening-stock",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = importOpeningStockSchema.parse(request.body);
      const job = await commitOpeningStockImport({ ...body, actorUserId: request.authUser!.id });
      return reply.code(job.status === "failed" ? 422 : 201).send(job);
    },
  );
}
