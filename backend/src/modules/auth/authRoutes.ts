import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const valid = await argon2.verify(user.passwordHash, body.password);
    if (!valid) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = app.jwt.sign({ sub: user.id }, { expiresIn: "12h" });
    return reply.send({ token });
  });
}
