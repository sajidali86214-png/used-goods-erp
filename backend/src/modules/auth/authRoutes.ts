import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { prisma, rawPrisma } from "../../lib/prisma.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    // rawPrisma, not the branch-scoped client: no branch context exists yet
    // at login — the user's own branchId is what establishes it, via the
    // JWT this issues and auth.ts's per-request lookup thereafter.
    const user = await rawPrisma.user.findUnique({ where: { email: body.email }, include: { branch: true } });
    if (!user || !user.isActive || !user.branch.isActive) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await rawPrisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = app.jwt.sign({ sub: user.id, branchId: user.branchId }, { expiresIn: "12h" });
    return reply.send({ token });
  });

  // Lets a client (admin-web, mobile) know who's logged in and what they can
  // see/do, without re-deriving permissions from the JWT itself.
  app.get("/auth/me", async (request, reply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.authUser.id },
      include: { roles: { include: { role: true } } },
    });
    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles.map((r) => r.role.code),
      permissions: [...request.authUser.permissions],
    });
  });
}
