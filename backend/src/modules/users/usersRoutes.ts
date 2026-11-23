import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma, rawPrisma } from "../../lib/prisma.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  roleIds: z.array(z.string().uuid()).min(1),
  // Only honored for a caller with branch.manage (owner) — see below. Lets an
  // owner set up a user for a branch other than the one they're currently
  // logged into (e.g. bootstrapping a brand-new branch's first staff
  // account). Ignored otherwise: an ordinary manager's new hire always joins
  // the manager's own branch.
  branchId: z.string().uuid().optional(),
});

export async function usersRoutes(app: FastifyInstance) {
  app.get("/roles", { preHandler: requirePermission("user.manage") }, async () => prisma.role.findMany({ orderBy: { code: "asc" } }));

  app.get(
    "/users",
    { preHandler: requirePermission("user.manage") },
    async () =>
      prisma.user.findMany({
        select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, branchId: true, roles: { include: { role: true } } },
        orderBy: { name: "asc" },
      }),
  );

  app.post(
    "/users",
    { preHandler: requirePermission("user.manage") },
    async (request, reply) => {
      const body = createUserSchema.parse(request.body);
      const canPickBranch = body.branchId && request.authUser!.permissions.has("branch.manage");

      const user = canPickBranch
        ? await rawPrisma.user.create({
            data: {
              branchId: body.branchId!,
              name: body.name,
              email: body.email,
              passwordHash: await argon2.hash(body.password),
              roles: { create: body.roleIds.map((roleId) => ({ roleId })) },
            },
            include: { roles: { include: { role: true } } },
          })
        : await prisma.user.create({
            data: {
              name: body.name,
              email: body.email,
              passwordHash: await argon2.hash(body.password),
              roles: { create: body.roleIds.map((roleId) => ({ roleId })) },
            },
            include: { roles: { include: { role: true } } },
          });

      const auditData = {
        actorUserId: request.authUser!.id,
        action: "create_user",
        entityType: "User",
        entityId: user.id,
        afterJson: { email: user.email, roleIds: body.roleIds },
      };
      // rawPrisma with an explicit branchId when the user was created in a
      // branch other than the caller's own — the scoped client would
      // otherwise stamp the audit event with the CALLER's branch instead of
      // the new user's actual one.
      if (canPickBranch) {
        await rawPrisma.auditEvent.create({ data: { ...auditData, branchId: user.branchId } });
      } else {
        await prisma.auditEvent.create({ data: auditData });
      }

      return reply.code(201).send(user);
    },
  );

  app.patch(
    "/users/:id/deactivate",
    { preHandler: requirePermission("user.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await prisma.user.update({ where: { id }, data: { isActive: false } });
      await prisma.auditEvent.create({
        data: { actorUserId: request.authUser!.id, action: "deactivate_user", entityType: "User", entityId: id, afterJson: { isActive: false } },
      });
      return reply.send(user);
    },
  );

  // Moving a user between branches is a deliberate, audited action — not an
  // incidental field edit — since it changes how their historical rows are
  // attributed. Owner-only (branch.manage), and inherently cross-branch, so
  // rawPrisma throughout rather than the branch-scoped client.
  app.patch(
    "/users/:id/branch",
    { preHandler: requirePermission("branch.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ branchId: z.string().uuid() }).parse(request.body);

      const before = await rawPrisma.user.findUniqueOrThrow({ where: { id } });
      const user = await rawPrisma.user.update({ where: { id }, data: { branchId: body.branchId } });

      await rawPrisma.auditEvent.create({
        data: {
          branchId: body.branchId,
          actorUserId: request.authUser!.id,
          action: "move_user_branch",
          entityType: "User",
          entityId: id,
          beforeJson: { branchId: before.branchId },
          afterJson: { branchId: body.branchId },
        },
      });

      return reply.send(user);
    },
  );
}
