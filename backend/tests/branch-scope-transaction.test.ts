import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, rawPrisma } from "../src/lib/prisma.js";
import { runSerializable } from "../src/lib/transaction.js";
import { enterBranchContext, runInBranchContext } from "../src/lib/branchContext.js";
import { TEST_MAIN_BRANCH_ID } from "./setup.js";

afterAll(async () => {
  await rawPrisma.$disconnect();
});

/**
 * Mandatory, blocking test from the multi-branch data-isolation plan: does a
 * Prisma Client Extension applied to the base client propagate into the `tx`
 * handed to `prisma.$transaction()`'s callback (which is exactly how
 * runSerializable works)? Prisma's own docs only caution about extensions
 * that call *client-level* methods from inside a transaction losing context
 * — this extension only rewrites `args` and calls the provided `query(args)`
 * callback, a different (and much more common) shape. This test settles it
 * empirically against the real Prisma 5.22 + Postgres stack in use here,
 * rather than assuming either way.
 */
describe("branch scope extension propagation into runSerializable's tx", () => {
  it("still filters by branch inside a SERIALIZABLE transaction callback", async () => {
    const branchB = await rawPrisma.branch.create({
      data: { name: `Branch-B-${randomUUID()}`, code: `B-${randomUUID().slice(0, 8)}` },
    });

    const binA = await runInBranchContext(TEST_MAIN_BRANCH_ID, () =>
      prisma.bin.create({ data: { code: `BINA-${randomUUID()}`, label: "Bin A" } }),
    );
    const binB = await runInBranchContext(branchB.id, () =>
      prisma.bin.create({ data: { code: `BINB-${randomUUID()}`, label: "Bin B" } }),
    );

    enterBranchContext({ branchId: TEST_MAIN_BRANCH_ID });
    const binsSeenInTx = await runSerializable(async (tx) => tx.bin.findMany({ where: { id: { in: [binA.id, binB.id] } } }));

    const ids = binsSeenInTx.map((b) => b.id);
    expect(ids).toContain(binA.id);
    expect(ids).not.toContain(binB.id);
  });
});
