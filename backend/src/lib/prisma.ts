import { PrismaClient } from "@prisma/client";
import { branchScopeExtension } from "./branchScopeExtension.js";

/**
 * The true, unscoped client. Only for: auth bootstrap (resolving a user's own
 * branchId before any branch context exists), the branch-management admin
 * routes (inherently cross-branch), the consolidated-report iterator, and
 * seed/backfill scripts. Never import this into ordinary business logic.
 */
export const rawPrisma = new PrismaClient();

/** The branch-scoped client every existing module already imports as `prisma`. */
export const prisma = rawPrisma.$extends(branchScopeExtension());
