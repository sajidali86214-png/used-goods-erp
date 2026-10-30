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
  maxRetries = 3,
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      attempt += 1;
      const isConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isConflict || attempt >= maxRetries) {
        throw err;
      }
    }
  }
}
