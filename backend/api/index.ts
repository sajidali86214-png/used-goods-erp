import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

/**
 * Vercel serverless entry point. Wraps the same Fastify app used for local
 * dev and any other host — nothing routes/middleware-wise is duplicated or
 * re-implemented here.
 *
 * Fastify builds its own http.Server at construction time (not at
 * `.listen()`), with its request router already wired to that server's
 * "request" event. Vercel's Node.js runtime hands us a real
 * IncomingMessage/ServerResponse pair per invocation (unlike, say, AWS API
 * Gateway's JSON event format), so the simplest correct bridge is just to
 * replay that event on Fastify's server instead of actually listening on a
 * port.
 *
 * The app instance (and its Prisma connection) is built once per warm
 * serverless instance and reused across invocations.
 */
let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
