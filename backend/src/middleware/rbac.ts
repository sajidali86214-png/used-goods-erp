import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode } from "../lib/permissions.js";

/**
 * Server-side permission gate. The UI hides actions a role can't take, but
 * this is the real enforcement point (spec: "enforce permissions and
 * business rules on the backend as well as in the interface" — acceptance
 * test #16: a picker calling a cost/profit/refund endpoint directly must be
 * denied regardless of what the client sent).
 */
export function requirePermission(code: PermissionCode) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    if (!request.authUser.permissions.has(code)) {
      return reply.code(403).send({ error: "forbidden", required: code });
    }
  };
}
