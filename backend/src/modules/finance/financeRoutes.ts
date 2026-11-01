import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { lockExchangeRate, latestRate } from "./currencyService.js";
import { recordCustomerReceipt, convertCurrency, totalReceivedForOrder } from "./paymentService.js";

const lockRateSchema = z.object({
  fromCurrencyId: z.string().uuid(),
  toCurrencyId: z.string().uuid(),
  rate: z.number().positive(),
  source: z.string().min(1),
  isManualOverride: z.boolean().optional(),
  overrideReason: z.string().optional(),
});

const receiptSchema = z.object({
  customerId: z.string().uuid().optional(),
  currencyId: z.string().uuid(),
  amount: z.number().positive(),
  receivedAt: z.coerce.date(),
  destinationAccountId: z.string().uuid(),
  bankReference: z.string().optional(),
  exchangeRateSnapshotId: z.string().uuid(),
  allocations: z.array(z.object({ orderId: z.string().uuid(), amount: z.number().positive() })).min(1),
});

const conversionSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  fromAmount: z.number().positive(),
  toAmount: z.number().positive(),
  rate: z.number().positive(),
  bankCharges: z.number().nonnegative().optional(),
});

export async function financeRoutes(app: FastifyInstance) {
  app.post(
    "/finance/exchange-rates",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = lockRateSchema.parse(request.body);
      const snapshot = await lockExchangeRate({ ...body, overrideByUserId: request.authUser!.id });
      return reply.code(201).send(snapshot);
    },
  );

  app.get(
    "/finance/exchange-rates/latest",
    { preHandler: requirePermission("finance.payment") },
    async (request) => {
      const { fromCurrencyId, toCurrencyId } = request.query as {
        fromCurrencyId: string;
        toCurrencyId: string;
      };
      return latestRate(fromCurrencyId, toCurrencyId);
    },
  );

  app.post(
    "/finance/receipts",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = receiptSchema.parse(request.body);
      const receipt = await recordCustomerReceipt(body);
      return reply.code(201).send(receipt);
    },
  );

  app.post(
    "/finance/conversions",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = conversionSchema.parse(request.body);
      const conversion = await convertCurrency(body);
      return reply.code(201).send(conversion);
    },
  );

  app.get(
    "/finance/orders/:id/received",
    { preHandler: requirePermission("finance.report.view") },
    async (request) => {
      const { id } = request.params as { id: string };
      const total = await totalReceivedForOrder(id);
      return { orderId: id, totalReceived: total.toString() };
    },
  );
}
