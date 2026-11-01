import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * If a request carries an Idempotency-Key header, replays the cached
 * response for a previously-seen (key, method, path) instead of running the
 * handler again. This is what makes "retry after a timeout" safe — the
 * client never knows whether the first attempt's response was lost, so it
 * must be able to resend the exact same request and get the exact same
 * result, not a second order/payment/GRN and a second movement set
 * (acceptance test #15).
 *
 * Only applies to mutating methods; a key on a GET is ignored since GETs
 * are already safe to retry.
 */
export const idempotencyPlugin = fp(async (app: FastifyInstance) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!["POST", "PUT", "PATCH"].includes(request.method)) return;

    const key = request.headers[IDEMPOTENCY_HEADER];
    if (!key || typeof key !== "string") return;

    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_method_path: { key, method: request.method, path: request.url } },
    });
    if (existing) {
      reply.header("Idempotent-Replay", "true");
      reply.code(existing.statusCode).send(JSON.parse(existing.responseBody));
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!["POST", "PUT", "PATCH"].includes(request.method)) return payload;

    const key = request.headers[IDEMPOTENCY_HEADER];
    if (!key || typeof key !== "string") return payload;

    // Already replayed above — don't overwrite the stored response.
    if (reply.getHeader("Idempotent-Replay")) return payload;

    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          method: request.method,
          path: request.url,
          statusCode: reply.statusCode,
          responseBody: body,
        },
      });
    } catch (err) {
      // Two concurrent retries racing to insert the same key — the loser
      // just means the winner's response is already cached; nothing to do.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
    }

    return payload;
  });
});
