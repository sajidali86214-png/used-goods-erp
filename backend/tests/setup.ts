import { beforeAll, beforeEach } from "vitest";
import { enterBranchContext } from "../src/lib/branchContext.js";

/**
 * Most tests call service functions directly (not through HTTP), so they
 * never go through auth.ts's onRequest hook — the one place that normally
 * sets branch context. Without this, every test touching a branch-scoped
 * model would throw "No branch context set". Tests that exercise real
 * multi-branch isolation (e.g. branch-isolation-http.test.ts) override this
 * per-request via real logins, same as production.
 *
 * Both beforeAll AND beforeEach: several HTTP test files create their fixture
 * user/role data inside a suite-level `beforeAll` (which runs before any
 * `beforeEach`), so `beforeEach` alone isn't enough to cover that setup code.
 */
export const TEST_MAIN_BRANCH_ID = "00000000-0000-0000-0000-000000000001";

beforeAll(() => {
  enterBranchContext({ branchId: TEST_MAIN_BRANCH_ID });
});

beforeEach(() => {
  enterBranchContext({ branchId: TEST_MAIN_BRANCH_ID });
});
