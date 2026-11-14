import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Runs `fn` inside a SERIALIZABLE transaction and retries on a Postgres
 * serialization failure (Prisma P2034) so concurrent stock operations on the
 * same (product, grade, bin, costLayer) row can never both succeed with a
 * stale read — one of them always gets a conflict and retries cleanly.
 * This is how "no negative stock" / "no double reservation" is kept safe
 * under concurrency without application-level locks.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxRetries = 8,
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Prisma's defaults (maxWait 2s, timeout 5s) are tight for a
        // multi-step transaction (several sequential round-trips) against a
        // remote Neon connection — comfortably fast from Vercel, but not
        // from a higher-latency connection (e.g. a one-off migration script
        // run from a developer machine). Longer limits cost nothing on the
        // fast path.
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (err) {
      attempt += 1;
      const isConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isConflict || attempt >= maxRetries) {
        throw err;
      }
      // Small randomized backoff so competing retries don't lock-step collide again.
      const backoffMs = Math.floor(Math.random() * 25 * attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}
