import "./config/env.js";
import Fastify from "fastify";
import { authPlugin } from "./middleware/auth.js";
import { authRoutes } from "./modules/auth/authRoutes.js";
import { stockRoutes } from "./modules/stock/stockRoutes.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(stockRoutes);

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
