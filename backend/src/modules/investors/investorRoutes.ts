import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";
import { listInvestors, createInvestor, updateInvestor, getInvestorDashboard } from "./investorService.js";

const createInvestorSchema = z.object({
  name: z.string().min(1),
  profitSharePercent: z.number().min(0).max(100),
  userId: z.string().uuid().optional(),
});

const updateInvestorSchema = z.object({
  name: z.string().min(1).optional(),
  profitSharePercent: z.number().min(0).max(100).optional(),
  userId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function investorRoutes(app: FastifyInstance) {
  // Admin management of investor records — who they are, their %, which login they're tied to.
  app.get("/investors", { preHandler: requirePermission("settings.manage") }, async () => listInvestors());

  app.post("/investors", { preHandler: requirePermission("settings.manage") }, async (request, reply) => {
    const body = createInvestorSchema.parse(request.body);
    const investor = await createInvestor(body);
    return reply.code(201).send(investor);
  });

  app.patch("/investors/:id", { preHandler: requirePermission("settings.manage") }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateInvestorSchema.parse(request.body);
    return updateInvestor(id, body);
  });

  // The restricted portal itself. A logged-in investor sees only their own
  // dashboard (resolved from their own user id) — an investorId query param
  // is only honored for an admin preview (settings.manage), never to look at
  // someone else's share as an investor.
  app.get("/investor/dashboard", { preHandler: requirePermission("investor.dashboard.view") }, async (request, reply) => {
    const { from, to, investorId: investorIdQuery } = request.query as { from?: string; to?: string; investorId?: string };

    let investorId: string | undefined;
    const ownInvestor = await prisma.investor.findUnique({ where: { userId: request.authUser!.id } });
    if (ownInvestor) {
      investorId = ownInvestor.id;
    } else if (investorIdQuery && request.authUser!.permissions.has("settings.manage")) {
      investorId = investorIdQuery;
    }

    if (!investorId) {
      return reply.code(404).send({ error: "no_investor_record_for_this_login" });
    }

    return getInvestorDashboard({
      investorId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  });
}
