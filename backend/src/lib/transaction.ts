import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";

// `prisma` is `rawPrisma.$extends(...)`, whose own `$transaction` has a much
// stricter, dynamically-computed callback type than plain `PrismaClient`.
// Casting the client itself (not just the callback) back to the plain,
// unextended shape lets TypeScript resolve `$transaction`'s ordinary
// overload — safe, since at runtime it's still the same client object with
// the same `$transaction` method; only the static type changes.
const plainPrisma = prisma as unknown as PrismaClient;
import { applyBranchScopedArgs, MODEL_NAME_BY_CLIENT_PROPERTY } from "./branchScopeExtension.js";
import { currentBranchId } from "./branchContext.js";

/**
 * Prisma's interactive-transaction client (the `tx` handed to
 * `$transaction()`'s callback) has no `.$extends()` of its own — confirmed
 * empirically (tests/branch-scope-transaction.test.ts first failed with
 * "tx.$extends is not a function"), not assumed. A query-rewriting Client
 * Extension applied to the base `prisma` client also does NOT propagate into
 * that `tx` object. So branch scoping inside a transaction is enforced here
 * instead, via a plain Proxy that applies the exact same
 * filter/inject-branchId logic the extension uses on the ordinary client.
 */
function scopeTransactionClient(tx: Prisma.TransactionClient, branchId: string): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const modelName = MODEL_NAME_BY_CLIENT_PROPERTY.get(prop as string);
      const orig = Reflect.get(target, prop, receiver);
      if (!modelName || typeof orig !== "object" || orig === null) return orig;
      return new Proxy(orig, {
        get(modelTarget, opProp, modelReceiver) {
          const fn = Reflect.get(modelTarget, opProp, modelReceiver);
          if (typeof fn !== "function") return fn;
          return (args: unknown) => fn.call(modelTarget, applyBranchScopedArgs(modelName, opProp as string, args, branchId));
        },
      });
    },
  }) as Prisma.TransactionClient;
}

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
  const branchId = currentBranchId();
  const scopedFn = (tx: Prisma.TransactionClient) => fn(scopeTransactionClient(tx, branchId));

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await plainPrisma.$transaction(scopedFn, {
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
