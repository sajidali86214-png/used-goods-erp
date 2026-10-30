import { describe, it, expect, vi } from "vitest";
import { requirePermission } from "../src/middleware/rbac.js";
import type { FastifyReply, FastifyRequest } from "fastify";

function mockReply() {
  const reply: Partial<FastifyReply> = {};
  reply.code = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply as FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe("acceptance test #16: backend denies access regardless of UI", () => {
  it("denies a picker (no cost.view) calling a cost.view-gated handler", async () => {
    const request = {
      authUser: { id: "picker-1", permissions: new Set(["order.pick", "stock.count"]) },
    } as unknown as FastifyRequest;
    const reply = mockReply();

    await requirePermission("cost.view")(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "forbidden", required: "cost.view" }),
    );
  });

  it("denies an unauthenticated request before checking permissions", async () => {
    const request = { authUser: undefined } as unknown as FastifyRequest;
    const reply = mockReply();

    await requirePermission("cost.view")(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("allows a finance user who holds cost.view", async () => {
    const request = {
      authUser: { id: "finance-1", permissions: new Set(["cost.view", "profit.view"]) },
    } as unknown as FastifyRequest;
    const reply = mockReply();

    const result = await requirePermission("cost.view")(request, reply);

    expect(result).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });
});
