import { AsyncLocalStorage } from "node:async_hooks";

export interface BranchContext {
  branchId: string;
}

const storage = new AsyncLocalStorage<BranchContext>();

/** Set once per request (auth.ts's onRequest hook) — lives for the rest of that request's async chain. */
export function enterBranchContext(ctx: BranchContext): void {
  storage.enterWith(ctx);
}

/** Fail closed: a per-branch-model query with no context set is a bug, not something to silently allow. */
export function currentBranchId(): string {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error("No branch context set for this request — auth.ts's onRequest hook must call enterBranchContext() first");
  }
  return ctx.branchId;
}

/**
 * Narrow escape hatch for the consolidated (all-branches) owner report path
 * only — see consolidatedReportService.ts. The inner `await` is deliberate,
 * not decorative: `storage.run()` only links async_hooks continuity to work
 * actually awaited *inside* the callback's own execution — merely returning
 * an unawaited lazy Prisma promise from a plain (non-async) callback does
 * NOT keep this context attached once that promise is later awaited by the
 * caller, confirmed empirically while building this.
 */
export function runInBranchContext<T>(branchId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ branchId }, async () => await fn());
}
