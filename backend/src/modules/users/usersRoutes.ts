import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { requirePermission } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  roleIds: z.array(z.string().uuid()).min(1),
});

export async function usersRoutes(app: FastifyInstance) {
  app.get("/roles", { preHandler: requirePermission("user.manage") }, async () => prisma.role.findMany({ orderBy: { code: "asc" } }));

  app.get(
    "/users",
    { preHandler: requirePermission("user.manage") },
    async () =>
      prisma.user.findMany({
        select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, roles: { include: { role: true } } },
        orderBy: { name: "asc" },
      }),
  );

  app.post(
    "/users",
    { preHandler: requirePermission("user.manage") },
    async (request, reply) => {
      const body = createUserSchema.parse(request.body);
      const user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash: await argon2.hash(body.password),
          roles: { create: body.roleIds.map((roleId) => ({ roleId })) },
        },
        include: { roles: { include: { role: true } } },
      });

      await prisma.auditEvent.create({
        data: { actorUserId: request.authUser!.id, action: "create_user", entityType: "User", entityId: user.id, afterJson: { email: user.email, roleIds: body.roleIds } },
      });

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
}
