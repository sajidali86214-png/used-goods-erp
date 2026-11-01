import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { prisma } from "../src/lib/prisma.js";

describe("users & audit-log routes", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let pickerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: "owner" } });
    const owner = await prisma.user.upsert({
      where: { email: "owner.users-audit-test@example.com" },
      update: {},
      create: { name: "Owner UA Test", email: "owner.users-audit-test@example.com", passwordHash: await argon2.hash("owner-test-pass") },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
      update: {},
      create: { userId: owner.id, roleId: ownerRole.id },
    });

    const pickerRole = await prisma.role.findUniqueOrThrow({ where: { code: "picker" } });
    const picker = await prisma.user.upsert({
      where: { email: "picker.users-audit-test@example.com" },
      update: {},
      create: { name: "Picker UA Test", email: "picker.users-audit-test@example.com", passwordHash: await argon2.hash("picker-test-pass") },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: picker.id, roleId: pickerRole.id } },
      update: {},
      create: { userId: picker.id, roleId: pickerRole.id },
    });

    ownerToken = (await app.inject({ method: "POST", url: "/auth/login", payload: { email: "owner.users-audit-test@example.com", password: "owner-test-pass" } })).json().token;
    pickerToken = (await app.inject({ method: "POST", url: "/auth/login", payload: { email: "picker.users-audit-test@example.com", password: "picker-test-pass" } })).json().token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("owner can list roles, create a user, and the action is audited", async () => {
    const rolesRes = await app.inject({ method: "GET", url: "/roles", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(rolesRes.statusCode).toBe(200);
    const pickerRole = rolesRes.json().find((r: { code: string }) => r.code === "picker");

    const createRes = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "New Hire", email: `new-hire-${randomUUID()}@example.com`, password: "a-secure-password", roleIds: [pickerRole.id] },
    });
    expect(createRes.statusCode).toBe(201);
    const newUser = createRes.json();

    const auditRes = await app.inject({
      method: "GET",
      url: `/audit-events?entityType=User`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().some((e: { entityId: string; action: string }) => e.entityId === newUser.id && e.action === "create_user")).toBe(true);
  });

  it("a picker (no user.manage / audit.view) is denied listing users and the audit log", async () => {
    const usersRes = await app.inject({ method: "GET", url: "/users", headers: { authorization: `Bearer ${pickerToken}` } });
    expect(usersRes.statusCode).toBe(403);

    const auditRes = await app.inject({ method: "GET", url: "/audit-events", headers: { authorization: `Bearer ${pickerToken}` } });
    expect(auditRes.statusCode).toBe(403);
  });
});
