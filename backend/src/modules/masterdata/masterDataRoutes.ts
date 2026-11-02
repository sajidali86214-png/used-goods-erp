import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

/**
 * CRUD for owner-configurable master/reference data (spec section 5).
 * Reads require only authentication (many roles need to see grades/bins/
 * channels while working); writes require settings.manage. Master records
 * are archived, never deleted, since transactions may reference them
 * (spec section 5).
 */
export async function masterDataRoutes(app: FastifyInstance) {
  // ---- Categories ----
  app.get("/settings/categories", async () => prisma.category.findMany({ orderBy: { name: "asc" } }));
  app.post(
    "/settings/categories",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ name: z.string().min(1), parentId: z.string().uuid().optional() }).parse(request.body);
      return reply.code(201).send(await prisma.category.create({ data: body }));
    },
  );
  app.patch(
    "/settings/categories/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ name: z.string().min(1).optional(), archivedAt: z.coerce.date().nullable().optional() }).parse(request.body);
      return prisma.category.update({ where: { id }, data: body });
    },
  );

  // ---- Grades ----
  app.get("/settings/grades", async () => prisma.grade.findMany({ orderBy: { code: "asc" } }));
  app.post(
    "/settings/grades",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ code: z.string().min(1), label: z.string().min(1), definition: z.string().optional() }).parse(request.body);
      return reply.code(201).send(await prisma.grade.create({ data: body }));
    },
  );
  app.patch(
    "/settings/grades/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ label: z.string().optional(), definition: z.string().optional(), archivedAt: z.coerce.date().nullable().optional() }).parse(request.body);
      return prisma.grade.update({ where: { id }, data: body });
    },
  );

  // ---- Bins ----
  app.get("/settings/bins", async () => prisma.bin.findMany({ orderBy: { code: "asc" } }));
  app.post(
    "/settings/bins",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ code: z.string().min(1), label: z.string().min(1) }).parse(request.body);
      return reply.code(201).send(await prisma.bin.create({ data: body }));
    },
  );
  app.patch(
    "/settings/bins/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ label: z.string().optional(), archivedAt: z.coerce.date().nullable().optional() }).parse(request.body);
      return prisma.bin.update({ where: { id }, data: body });
    },
  );

  // ---- Currencies ----
  app.get("/settings/currencies", async () => prisma.currency.findMany({ orderBy: { code: "asc" } }));
  app.post(
    "/settings/currencies",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ code: z.string().min(1), symbol: z.string().min(1), decimalPlaces: z.number().int().optional() }).parse(request.body);
      return reply.code(201).send(await prisma.currency.create({ data: body }));
    },
  );

  // ---- Sales channels ----
  app.get("/settings/channels", async () => prisma.salesChannel.findMany({ orderBy: { code: "asc" } }));
  app.post(
    "/settings/channels",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ code: z.string().min(1), label: z.string().min(1), defaultCommissionPct: z.number().optional() }).parse(request.body);
      return reply.code(201).send(await prisma.salesChannel.create({ data: body }));
    },
  );
  app.patch(
    "/settings/channels/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ label: z.string().optional(), defaultCommissionPct: z.number().optional(), archivedAt: z.coerce.date().nullable().optional() }).parse(request.body);
      return prisma.salesChannel.update({ where: { id }, data: body });
    },
  );

  // ---- Expense categories ----
  app.get("/settings/expense-categories", async () => prisma.expenseCategory.findMany({ orderBy: { label: "asc" } }));
  app.post(
    "/settings/expense-categories",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ label: z.string().min(1) }).parse(request.body);
      return reply.code(201).send(await prisma.expenseCategory.create({ data: body }));
    },
  );

  // ---- Reason codes ----
  app.get("/settings/reason-codes", async () => prisma.reasonCode.findMany({ orderBy: { label: "asc" } }));
  app.post(
    "/settings/reason-codes",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ kind: z.enum(["cancellation", "return", "adjustment"]), label: z.string().min(1) }).parse(request.body);
      return reply.code(201).send(await prisma.reasonCode.create({ data: body }));
    },
  );

  // ---- Accounts (bank/cash — control accounts are seeded, not created here) ----
  app.get("/settings/accounts", async () => prisma.account.findMany({ where: { kind: { not: "control" } }, orderBy: { label: "asc" } }));
  app.post(
    "/settings/accounts",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z
        .object({ label: z.string().min(1), currencyId: z.string().uuid(), kind: z.enum(["cash", "bank", "platform_escrow"]) })
        .parse(request.body);
      return reply.code(201).send(await prisma.account.create({ data: { ...body, nature: "asset" } }));
    },
  );

  // ---- Products ----
  app.get("/products", async (request) => {
    const { search } = request.query as { search?: string };
    return prisma.product.findMany({
      where: search ? { OR: [{ skuCode: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }] } : undefined,
      include: { category: true },
      orderBy: { skuCode: "asc" },
      take: 200,
    });
  });
  app.get("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({ where: { id }, include: { category: true } });
    if (!product) return reply.code(404).send({ error: "not_found" });
    return product;
  });
  app.post(
    "/products",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z
        .object({
          skuCode: z.string().min(1),
          name: z.string().min(1),
          categoryId: z.string().uuid(),
          unitOfMeasure: z.string().optional(),
          description: z.string().optional(),
          brand: z.string().optional(),
          defaultSellPrice: z.number().optional(),
          minPrice: z.number().optional(),
        })
        .parse(request.body);
      const product = await prisma.product.create({
        data: {
          ...body,
          defaultSellPrice: body.defaultSellPrice !== undefined ? new Decimal(body.defaultSellPrice) : undefined,
          minPrice: body.minPrice !== undefined ? new Decimal(body.minPrice) : undefined,
        },
      });
      return reply.code(201).send(product);
    },
  );
  app.patch(
    "/products/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          name: z.string().optional(),
          description: z.string().optional(),
          defaultSellPrice: z.number().optional(),
          minPrice: z.number().optional(),
          isActive: z.boolean().optional(),
          archivedAt: z.coerce.date().nullable().optional(),
        })
        .parse(request.body);
      return prisma.product.update({
        where: { id },
        data: {
          ...body,
          defaultSellPrice: body.defaultSellPrice !== undefined ? new Decimal(body.defaultSellPrice) : undefined,
          minPrice: body.minPrice !== undefined ? new Decimal(body.minPrice) : undefined,
        },
      });
    },
  );

  // ---- Suppliers ----
  app.get("/suppliers", async (request) => {
    const { search } = request.query as { search?: string };
    return prisma.supplier.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { name: "asc" },
      take: 200,
    });
  });
  app.get(
    "/suppliers/:id",
    { preHandler: requirePermission("supplier.payment_details.view") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const supplier = await prisma.supplier.findUnique({ where: { id } });
      if (!supplier) return reply.code(404).send({ error: "not_found" });
      return supplier;
    },
  );
  app.post(
    "/suppliers",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z
        .object({
          name: z.string().min(1),
          defaultCurrencyId: z.string().uuid(),
          contactPerson: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
        })
        .parse(request.body);
      return reply.code(201).send(await prisma.supplier.create({ data: body }));
    },
  );

  // ---- Customers ----
  app.get("/customers", async (request) => {
    const { search } = request.query as { search?: string };
    return prisma.customer.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { name: "asc" },
      take: 200,
    });
  });
  app.post(
    "/customers",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const body = z.object({ name: z.string().min(1), contact: z.string().optional(), address: z.string().optional(), notes: z.string().optional() }).parse(request.body);
      return reply.code(201).send(await prisma.customer.create({ data: body }));
    },
  );
}
