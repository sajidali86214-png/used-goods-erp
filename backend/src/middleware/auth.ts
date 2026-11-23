import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { createVerifier } from "fast-jwt";
import type { FastifyInstance } from "fastify";
import { rawPrisma } from "../lib/prisma.js";
import type { PermissionCode } from "../lib/permissions.js";
import { enterBranchContext } from "../lib/branchContext.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      branchId: string;
      permissions: Set<PermissionCode>;
    };
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET must be set (see backend/.env.example)");
  }
  // @fastify/jwt is kept registered for its convenient `app.jwt.sign()` used
  // by authRoutes.ts at login. Verification on every other request deliberately
  // does NOT use its `request.jwtVerify()` — see the sync verifier below.
  await app.register(jwt, { secret });

  // fast-jwt's verifier is synchronous for a plain HMAC secret (no async key
  // provider) — it returns the payload or throws, with no Promise involved.
  // This matters a lot here, not just as a style choice: confirmed
  // empirically that Fastify's onRequest hook loses its AsyncLocalStorage
  // context by the time the next lifecycle phase (preHandler/handler) runs,
  // for ANY hook that awaits something — even a no-op `await
  // Promise.resolve()` — before the context is set. So branchId must be
  // established from a cryptographically-verified JWT claim with zero prior
  // awaits in this hook; verifying asynchronously (as request.jwtVerify()
  // does) would silently break branch scoping for every route that doesn't
  // happen to also require a permission (most of them do, but this must not
  // depend on that).
  const verify = createVerifier({ key: secret });

  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return; // no token — authUser and branch context both stay unset, routes decide
    }

    let payload: { sub: string; branchId: string };
    try {
      payload = verify(header.slice("Bearer ".length)) as { sub: string; branchId: string };
    } catch {
      return; // invalid/expired token — same as above, nothing set
    }

    // Trusted now (signature verified) — safe to set context with zero
    // awaits so far in this hook's execution.
    enterBranchContext({ branchId: payload.branchId });

    // rawPrisma: re-read fresh every request (not the JWT's cached
    // branchId) so moving a user to a different branch, or deactivating
    // their branch, takes effect immediately rather than waiting out the
    // token's up-to-12h lifetime. The branch context above is provisional
    // until this confirms it; a mismatch (stale token after a branch move)
    // is corrected below before any route handler runs.
    const user = await rawPrisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        branch: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    if (!user || !user.isActive) {
      return; // deleted/deactivated user — authUser stays undefined, routes decide
    }
    if (!user.branch.isActive) {
      return reply.code(401).send({ error: "branch_deactivated" });
    }
    if (user.branchId !== payload.branchId) {
      // User was moved to a different branch since this token was issued.
      // Can't safely correct the context for THIS request (re-calling
      // enterBranchContext here, after the await above, would hit the exact
      // hook-continuity issue this file's top comment describes) — reject
      // and make them log in again for a token carrying the right branch,
      // rather than silently serving the stale one.
      return reply.code(401).send({ error: "branch_changed_please_relogin" });
    }

    const permissions = new Set<PermissionCode>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.code as PermissionCode);
      }
    }
    request.authUser = { id: user.id, branchId: user.branchId, permissions };
  });
});
