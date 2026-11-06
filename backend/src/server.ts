import { env } from "./config/env.js";
import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { authPlugin } from "./middleware/auth.js";
import { idempotencyPlugin } from "./middleware/idempotency.js";
import { authRoutes } from "./modules/auth/authRoutes.js";
import { stockRoutes } from "./modules/stock/stockRoutes.js";
import { salesRoutes } from "./modules/sales/salesRoutes.js";
import { financeRoutes } from "./modules/finance/financeRoutes.js";
import { purchasingRoutes } from "./modules/purchasing/purchasingRoutes.js";
import { importRoutes } from "./modules/imports/importRoutes.js";
import { reportRoutes } from "./modules/reports/reportRoutes.js";
import { masterDataRoutes } from "./modules/masterdata/masterDataRoutes.js";
import { usersRoutes } from "./modules/users/usersRoutes.js";
import { auditRoutes } from "./modules/audit/auditRoutes.js";
import { mediaRoutes, UPLOADS_DIR } from "./modules/media/mediaRoutes.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  });

  await mkdir(UPLOADS_DIR, { recursive: true }); // @fastify/static requires `root` to exist at registration time

  await app.register(multipart);
  await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: "/media/files/", decorateReply: false });

  await app.register(authPlugin);
  await app.register(idempotencyPlugin);
  await app.register(authRoutes);
  await app.register(mediaRoutes);
  await app.register(stockRoutes);
  await app.register(salesRoutes);
  await app.register(financeRoutes);
  await app.register(purchasingRoutes);
  await app.register(importRoutes);
  await app.register(reportRoutes);
  await app.register(masterDataRoutes);
  await app.register(usersRoutes);
  await app.register(auditRoutes);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
}

const isDirectRun = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
