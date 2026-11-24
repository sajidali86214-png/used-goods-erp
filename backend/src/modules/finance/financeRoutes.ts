import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission, requireAnyPermission } from "../../middleware/rbac.js";
import { lockExchangeRate, latestRate } from "./currencyService.js";
import { refreshAllExchangeRates } from "./exchangeRateRefreshService.js";
import { recordCustomerReceipt, convertCurrency, totalReceivedForOrder, recordTransfer } from "./paymentService.js";
import {
  postExpense,
  postSupplierAdvance,
  postCustomerReceipt,
  postRefund,
  postSaleDispatch,
  postTransfer,
  postOwnerTransaction,
  getAccountBalance,
  settleExpensePayment,
} from "./ledgerService.js";
import { lockPeriod, reopenPeriod } from "./periodLockService.js";
import { getAccountStatement } from "./financeStatementService.js";
import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

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

const createOwnerTransactionSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  type: z.enum(["contribution", "withdrawal"]),
  occurredAt: z.coerce.date().optional(),
});

const createTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.number().positive(),
  occurredAt: z.coerce.date().optional(),
});

const createExpenseSchema = z.object({
  date: z.coerce.date(),
  payeeType: z.enum(["supplier", "other"]),
  payeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid(),
  currencyId: z.string().uuid(),
  amount: z.number().positive(),
  paymentStatus: z.enum(["unpaid", "paid"]).default("paid"),
  accountId: z.string().uuid(),
  relatedOrderId: z.string().uuid().optional(),
  relatedLotId: z.string().uuid().optional(),
});

export async function financeRoutes(app: FastifyInstance) {
  app.post(
    "/finance/expenses",
    { preHandler: requirePermission("finance.expense") },
    async (request, reply) => {
      const body = createExpenseSchema.parse(request.body);
      const expense = await prisma.expense.create({
        data: { ...body, amount: new Decimal(body.amount), approvedByUserId: request.authUser!.id },
      });
      // Posts immediately (whether paid or unpaid — postExpense already
      // credits the paying account if paid, Accounts Payable if not). Same
      // non-atomic two-call pattern fixed elsewhere this session: a second,
      // separate call to /finance/post/expenses/:id left an expense that
      // could exist with no ledger impact if that second call never
      // happened.
      await postExpense(expense.id, request.authUser!.id);
      return reply.code(201).send(expense);
    },
  );

  app.get(
    "/finance/expenses",
    { preHandler: requirePermission("finance.report.view") },
    async (request) => {
      const { paymentStatus } = request.query as { paymentStatus?: string };
      return prisma.expense.findMany({
        where: paymentStatus ? { paymentStatus } : undefined,
        include: { account: true },
        orderBy: { date: "desc" },
        take: 200,
      });
    },
  );

  app.post(
    "/finance/expenses/:id/settle",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ payingAccountId: z.string().uuid() }).parse(request.body);
      try {
        const expense = await settleExpensePayment(id, body.payingAccountId, request.authUser!.id);
        return reply.send(expense);
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : "could_not_settle" });
      }
    },
  );

  // Also how an account's opening balance is recorded. Posts in the same
  // request — this used to be a separate call to
  // /finance/post/owner-transactions/:id, the same non-atomic two-call
  // pattern fixed for supplier advances and sales dispatch elsewhere this
  // session: nothing detected or retried a failure between create and post,
  // so a contribution/withdrawal could exist with no account impact.
  app.post(
    "/finance/owner-transactions",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = createOwnerTransactionSchema.parse(request.body);
      const tx = await prisma.ownerTransaction.create({
        data: { ...body, amount: new Decimal(body.amount) },
      });
      await postOwnerTransaction(tx.id, request.authUser!.id);
      return reply.code(201).send(tx);
    },
  );

  app.post(
    "/finance/transfers",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = createTransferSchema.parse(request.body);
      try {
        const transfer = await recordTransfer({ ...body, actorUserId: request.authUser!.id });
        return reply.code(201).send(transfer);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "could_not_transfer" });
      }
    },
  );

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
    // Also order.create: a seller entering a non-PKR sales order needs to
    // fetch/pre-fill a rate too, not just finance.payment holders.
    { preHandler: requireAnyPermission(["finance.payment", "order.create"]) },
    async (request) => {
      const { fromCurrencyId, toCurrencyId } = request.query as {
        fromCurrencyId: string;
        toCurrencyId: string;
      };
      return latestRate(fromCurrencyId, toCurrencyId);
    },
  );

  // Triggered by Vercel Cron (see vercel.json's "crons" entry) once a day —
  // there's no logged-in user on a cron request, so this checks CRON_SECRET
  // directly instead of going through requirePermission. Accepts the secret
  // either as a Bearer header (in case Vercel's own cron auth sends one) or
  // as a query param (guaranteed to work since the cron path itself is ours
  // to configure in vercel.json) — whichever arrives, if either.
  app.get("/finance/exchange-rates/refresh-live", async (request, reply) => {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return reply.code(500).send({ error: "CRON_SECRET is not configured" });
    }
    const header = request.headers.authorization;
    const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const queryToken = (request.query as { secret?: string }).secret;
    if (bearerToken !== expected && queryToken !== expected) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const results = await refreshAllExchangeRates();
    return reply.send({ results });
  });

  app.post(
    "/finance/receipts",
    { preHandler: requirePermission("finance.payment") },
    async (request, reply) => {
      const body = receiptSchema.parse(request.body);
      const receipt = await recordCustomerReceipt(body);
      // This form had no way to post the receipt at all — it created a
      // PaymentReceipt/PaymentAllocation that getCustomerBalances would
      // already count as "received", but with zero ledger entries, so it
      // never touched any account's actual balance or the AR account.
      // Posts immediately now, same as every other receipt-creating path.
      await postCustomerReceipt(receipt.id, request.authUser!.id);
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

  const postById = (fn: (id: string, actorUserId: string) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await fn(id, request.authUser!.id);
      return reply.code(201).send(result);
    };

  app.post("/finance/post/expenses/:id", { preHandler: requirePermission("finance.payment") }, postById(postExpense));
  app.post(
    "/finance/post/supplier-advances/:id",
    { preHandler: requirePermission("finance.payment") },
    postById(postSupplierAdvance),
  );
  app.post(
    "/finance/post/receipts/:id",
    { preHandler: requirePermission("finance.payment") },
    postById(postCustomerReceipt),
  );
  app.post("/finance/post/refunds/:id", { preHandler: requirePermission("finance.payment") }, postById(postRefund));
  app.post(
    "/finance/post/shipment-lines/:id",
    { preHandler: requirePermission("finance.payment") },
    postById(postSaleDispatch),
  );
  app.post(
    "/finance/post/transfers/:id",
    { preHandler: requirePermission("finance.payment") },
    postById(postTransfer),
  );
  app.post(
    "/finance/post/owner-transactions/:id",
    { preHandler: requirePermission("finance.payment") },
    postById(postOwnerTransaction),
  );

  app.get(
    "/finance/accounts/:id/balance",
    { preHandler: requirePermission("finance.report.view") },
    async (request) => {
      const { id } = request.params as { id: string };
      const balance = await getAccountBalance(id);
      return { accountId: id, balance: balance.toString() };
    },
  );

  app.get(
    "/finance/accounts/:id/statement",
    { preHandler: requirePermission("finance.report.view") },
    async (request) => {
      const { id } = request.params as { id: string };
      const { from, to } = request.query as { from?: string; to?: string };
      return getAccountStatement({ accountId: id, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
    },
  );

  app.post(
    "/finance/periods/lock",
    { preHandler: requirePermission("period.reopen") },
    async (request, reply) => {
      const body = z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }).parse(request.body);
      const lock = await lockPeriod({ ...body, lockedByUserId: request.authUser!.id });
      return reply.code(201).send(lock);
    },
  );

  app.post(
    "/finance/periods/:id/reopen",
    { preHandler: requirePermission("period.reopen") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ reason: z.string().min(1) }).parse(request.body);
      const lock = await reopenPeriod({ periodLockId: id, reopenedByUserId: request.authUser!.id, reason: body.reason });
      return reply.send(lock);
    },
  );
}
