import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    "/audit-events",
    { preHandler: requirePermission("audit.view") },
    async (request) => {
      const { entityType, entityId, limit } = request.query as { entityType?: string; entityId?: string; limit?: string };
      return prisma.auditEvent.findMany({
        where: { entityType: entityType || undefined, entityId: entityId || undefined },
        orderBy: { createdAt: "desc" },
        take: limit ? Math.min(Number(limit), 500) : 100,
      });
    },
  );
}
