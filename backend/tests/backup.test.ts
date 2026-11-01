import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createEncryptedBackup, restoreAndVerify, dropDatabase } from "../src/modules/backup/backupService.js";
import { seedReferenceData } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
});

const canRunRestoreTest =
  !!process.env.TEST_POSTGRES_SUPERUSER_URL && !!process.env.BACKUP_ENCRYPTION_KEY_HEX;

/**
 * Acceptance test #20 (database half only — media/Drive is a separate,
 * owner-approved integration not built yet, see backend/README.md).
 * Skips cleanly in any environment without TEST_POSTGRES_SUPERUSER_URL /
 * BACKUP_ENCRYPTION_KEY_HEX set, rather than failing or faking success.
 */
describe.skipIf(!canRunRestoreTest)("acceptance test #20: encrypted backup + isolated restore test", () => {
  it("dumps, encrypts, and restores into a fresh database with matching row counts", async () => {
    const { product, user } = await seedReferenceData();
    const expectedUserCount = await prisma.user.count();
    const expectedProductCount = await prisma.product.count();

    const outputDir = path.join(os.tmpdir(), `erp-backup-test-${randomUUID()}`);
    const backup = await createEncryptedBackup({
      databaseUrl: process.env.DATABASE_URL!,
      outputDir,
      encryptionKeyHex: process.env.BACKUP_ENCRYPTION_KEY_HEX!,
      pgBinDir: process.env.PG_BIN_DIR,
    });

    expect(backup.sizeBytes).toBeGreaterThan(0);
    expect(backup.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // No plaintext dump left behind — only the encrypted file and manifest.
    const dirContents = await fs.readdir(outputDir);
    expect(dirContents.some((f) => f.endsWith(".sql") && !f.endsWith(".sql.enc"))).toBe(false);
    expect(dirContents.some((f) => f.endsWith(".sql.enc"))).toBe(true);
    expect(dirContents.some((f) => f.startsWith("manifest-"))).toBe(true);

    const restoreDbName = `erp_restore_test_${Date.now()}`;
    let restored: Awaited<ReturnType<typeof restoreAndVerify>> | undefined;
    try {
      restored = await restoreAndVerify({
        encryptedFilePath: backup.encryptedFilePath,
        manifestPath: backup.manifestPath,
        encryptionKeyHex: process.env.BACKUP_ENCRYPTION_KEY_HEX!,
        superuserAdminUrl: process.env.TEST_POSTGRES_SUPERUSER_URL!,
        restoreDatabaseName: restoreDbName,
        restoreOwnerRole: "erp_app",
        pgBinDir: process.env.PG_BIN_DIR,
        tmpDir: outputDir,
      });

      expect(restored.checksumMatches).toBe(true);
      expect(restored.ok).toBe(true);
      expect(restored.durationMs).toBeGreaterThan(0);

      const restoredClient = new PrismaClient({
        datasources: { db: { url: restored.restoredDatabaseUrl } },
      });
      try {
        const restoredUserCount = await restoredClient.user.count();
        const restoredProductCount = await restoredClient.product.count();
        expect(restoredUserCount).toBe(expectedUserCount);
        expect(restoredProductCount).toBe(expectedProductCount);

        const restoredProduct = await restoredClient.product.findUnique({ where: { id: product.id } });
        expect(restoredProduct?.skuCode).toBe(product.skuCode);
        const restoredUser = await restoredClient.user.findUnique({ where: { id: user.id } });
        expect(restoredUser?.email).toBe(user.email);
      } finally {
        await restoredClient.$disconnect();
      }
    } finally {
      await dropDatabase({
        superuserAdminUrl: process.env.TEST_POSTGRES_SUPERUSER_URL!,
        databaseName: restoreDbName,
        pgBinDir: process.env.PG_BIN_DIR,
      });
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});
