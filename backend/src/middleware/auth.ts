import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import type { PermissionCode } from "../lib/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      permissions: Set<PermissionCode>;
    };
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set (see backend/.env.example)");
  }
  await app.register(jwt, { secret });

  app.addHook("onRequest", async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      return; // no/invalid token — authUser stays undefined, routes decide
    }
    const payload = request.user as { sub: string };
    const userRoles = await prisma.userRole.findMany({
      where: { userId: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = new Set<PermissionCode>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code as PermissionCode);
      }
    }
    request.authUser = { id: payload.sub, permissions };
  });
});
