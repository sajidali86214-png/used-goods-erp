import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../../middleware/rbac.js";
import { rawPrisma } from "../../lib/prisma.js";

const createBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});

/**
 * Owner-only, inherently cross-branch administration — always rawPrisma,
 * never the branch-scoped client (there is no single "current branch" that
 * would make sense for "list every branch" or "create a new one").
 */
export async function branchRoutes(app: FastifyInstance) {
  app.get(
    "/branches",
    { preHandler: requirePermission("branch.manage") },
    async () => rawPrisma.branch.findMany({ orderBy: { name: "asc" } }),
  );

  app.post(
    "/branches",
    { preHandler: requirePermission("branch.manage") },
    async (request, reply) => {
      const body = createBranchSchema.parse(request.body);
      const branch = await rawPrisma.branch.create({ data: body });

      await rawPrisma.auditEvent.create({
        data: {
          branchId: branch.id,
          actorUserId: request.authUser!.id,
          action: "create_branch",
          entityType: "Branch",
          entityId: branch.id,
          afterJson: { name: branch.name, code: branch.code },
        },
      });

      return reply.code(201).send(branch);
    },
  );

  app.patch(
    "/branches/:id/deactivate",
    { preHandler: requirePermission("branch.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const branch = await rawPrisma.branch.update({ where: { id }, data: { isActive: false } });
      await rawPrisma.auditEvent.create({
        data: {
          branchId: branch.id,
          actorUserId: request.authUser!.id,
          action: "deactivate_branch",
          entityType: "Branch",
          entityId: id,
          afterJson: { isActive: false },
        },
      });
      return reply.send(branch);
    },
  );

  app.patch(
    "/branches/:id/activate",
    { preHandler: requirePermission("branch.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const branch = await rawPrisma.branch.update({ where: { id }, data: { isActive: true } });
      await rawPrisma.auditEvent.create({
        data: {
          branchId: branch.id,
          actorUserId: request.authUser!.id,
          action: "activate_branch",
          entityType: "Branch",
          entityId: id,
          afterJson: { isActive: true },
        },
      });
      return reply.send(branch);
    },
  );
}
