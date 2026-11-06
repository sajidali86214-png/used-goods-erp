import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { generateSkuCode } from "./skuGenerator.js";
import { computeOrderCostSummary } from "../sales/salesOrderService.js";
import { mediaUrl, deleteUploadedFile } from "../media/storage.js";

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

  // ---- Brands ----
  app.get("/settings/brands", async () => prisma.brand.findMany({ orderBy: { name: "asc" } }));
  app.post(
    "/settings/brands",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z.object({ name: z.string().min(1) }).parse(request.body);
      return reply.code(201).send(await prisma.brand.create({ data: body }));
    },
  );
  app.patch(
    "/settings/brands/:id",
    { preHandler: requirePermission("settings.manage") },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = z.object({ name: z.string().min(1).optional(), archivedAt: z.coerce.date().nullable().optional() }).parse(request.body);
      return prisma.brand.update({ where: { id }, data: body });
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
      include: { category: true, brand: true },
      orderBy: { skuCode: "asc" },
      take: 200,
    });
  });
  app.get("/products/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({ where: { id }, include: { category: true, brand: true } });
    if (!product) return reply.code(404).send({ error: "not_found" });
    return product;
  });
  app.post(
    "/products",
    { preHandler: requirePermission("settings.manage") },
    async (request, reply) => {
      const body = z
        .object({
          name: z.string().min(1),
          categoryId: z.string().uuid(),
          brandId: z.string().uuid().optional(),
          unitOfMeasure: z.string().optional(),
          description: z.string().optional(),
          defaultSellPrice: z.number().optional(),
          minPrice: z.number().optional(),
        })
        .parse(request.body);
      const skuCode = await generateSkuCode(body.categoryId);
      const product = await prisma.product.create({
        data: {
          ...body,
          skuCode,
          defaultSellPrice: body.defaultSellPrice !== undefined ? new Decimal(body.defaultSellPrice) : undefined,
          minPrice: body.minPrice !== undefined ? new Decimal(body.minPrice) : undefined,
        },
        include: { category: true, brand: true },
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
          brandId: z.string().uuid().nullable().optional(),
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

  // ---- Product photos ----
  app.get("/products/:id/photos", async (request) => {
    const { id } = request.params as { id: string };
    const photos = await prisma.productPhoto.findMany({ where: { productId: id }, include: { media: true }, orderBy: { id: "asc" } });
    return photos.map((p) => ({ ...p, url: mediaUrl(p.media.storageKey) }));
  });
  app.post(
    "/products/:id/photos",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ mediaAssetId: z.string().uuid(), caption: z.string().optional() }).parse(request.body);
      const existingCount = await prisma.productPhoto.count({ where: { productId: id } });
      const photo = await prisma.productPhoto.create({
        data: { productId: id, mediaAssetId: body.mediaAssetId, caption: body.caption, isRepresentative: existingCount === 0 },
        include: { media: true },
      });
      return reply.code(201).send(photo);
    },
  );
  app.delete(
    "/products/:id/photos/:photoId",
    { preHandler: requirePermission("stock.receive") },
    async (request, reply) => {
      const { photoId } = request.params as { id: string; photoId: string };
      const photo = await prisma.productPhoto.delete({ where: { id: photoId }, include: { media: true } });
      await deleteUploadedFile(photo.media.storageKey);
      return reply.code(204).send();
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
      const body = z
        .object({
          name: z.string().min(1),
          contact: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          country: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(request.body);
      return reply.code(201).send(await prisma.customer.create({ data: body }));
    },
  );

  app.get("/customers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return reply.code(404).send({ error: "not_found" });

    const orders = await prisma.salesOrder.findMany({
      where: { customerId: id },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
    });

    // Net receivable per order, after discount/shipping/commission — not the raw
    // gross (quantity * unitPrice) — since that's what the customer actually owes.
    let bookedValue = new Decimal(0);
    for (const order of orders) {
      bookedValue = bookedValue.plus(computeOrderCostSummary(order).netTotal);
    }
    // Per order: the manual "payment received" popup amount takes precedence
    // over real PaymentAllocation totals, same rule as getOrderPaymentSummary.
    const ordersNeedingAllocationLookup = orders.filter((o) => o.paymentReceivedAmount === null);
    const allocations = await prisma.paymentAllocation.findMany({
      where: { orderId: { in: ordersNeedingAllocationLookup.map((o) => o.id) } },
    });
    let received = new Decimal(0);
    for (const order of orders) {
      if (order.paymentReceivedAmount !== null) {
        received = received.plus(order.paymentReceivedAmount);
      } else {
        received = received.plus(sumDecimal(allocations.filter((a) => a.orderId === order.id).map((a) => a.amount)));
      }
    }

    return {
      ...customer,
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        externalOrderId: o.externalOrderId,
        status: o.status,
        fulfilmentStatus: o.fulfilmentStatus,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        lineCount: o.lines.length,
      })),
      balance: { bookedValue, received, outstanding: bookedValue.minus(received) },
    };
  });

  app.patch(
    "/customers/:id",
    { preHandler: requirePermission("order.create") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          name: z.string().min(1).optional(),
          contact: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          country: z.string().optional(),
          notes: z.string().optional(),
          isActive: z.boolean().optional(),
        })
        .parse(request.body);
      const customer = await prisma.customer.update({ where: { id }, data: body });
      return reply.send(customer);
    },
  );
}
