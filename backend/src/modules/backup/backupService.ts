import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

function pgBin(dir: string | undefined, name: string): string {
  if (!dir) return name; // fall back to PATH
  return platform() === "win32" ? path.join(dir, `${name}.exe`) : path.join(dir, name);
}

function withDbName(connectionUrl: string, databaseName: string): string {
  const url = new URL(connectionUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function extractPassword(connectionUrl: string): string {
  return new URL(connectionUrl).password;
}

/** Strips Prisma-only query params (like ?schema=) that libpq tools (pg_dump/psql) don't understand. */
function toLibpqUri(connectionUrl: string): string {
  const url = new URL(connectionUrl);
  url.search = "";
  return url.toString();
}

export interface BackupResult {
  manifestPath: string;
  encryptedFilePath: string;
  checksumSha256: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Dumps the database (plain SQL, via pg_dump), encrypts it with AES-256-GCM,
 * writes a manifest with a checksum, and never leaves a plaintext dump on
 * disk. This is the local half of spec section 16's nightly backup package;
 * the Google Drive copy step is a separate, owner-approved integration not
 * built here (needs a real service account — see docs/05-decisions-needed.md).
 */
export async function createEncryptedBackup(params: {
  databaseUrl: string;
  outputDir: string;
  encryptionKeyHex: string; // 64 hex chars = 32 bytes, AES-256
  pgBinDir?: string;
}): Promise<BackupResult> {
  const key = Buffer.from(params.encryptionKeyHex, "hex");
  if (key.length !== 32) {
    throw new Error("encryptionKeyHex must decode to exactly 32 bytes for AES-256");
  }

  await fs.mkdir(params.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = path.join(params.outputDir, `dump-${timestamp}.sql`);
  const encPath = path.join(params.outputDir, `dump-${timestamp}.sql.enc`);
  const manifestPath = path.join(params.outputDir, `manifest-${timestamp}.json`);

  await execFileAsync(pgBin(params.pgBinDir, "pg_dump"), [
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    `--file=${dumpPath}`,
    toLibpqUri(params.databaseUrl),
  ]);

  const plaintext = await fs.readFile(dumpPath);
  const checksumSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: 12-byte IV + 16-byte auth tag + ciphertext.
  await fs.writeFile(encPath, Buffer.concat([iv, authTag, ciphertext]));
  await fs.rm(dumpPath);

  const createdAt = new Date().toISOString();
  const manifest = {
    createdAt,
    checksumSha256,
    sizeBytes: plaintext.length,
    encryptedFile: path.basename(encPath),
    encryptionAlgo: "aes-256-gcm",
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return { manifestPath, encryptedFilePath: encPath, checksumSha256, sizeBytes: plaintext.length, createdAt };
}

export async function decryptBackup(params: {
  encryptedFilePath: string;
  encryptionKeyHex: string;
}): Promise<Buffer> {
  const key = Buffer.from(params.encryptionKeyHex, "hex");
  const raw = await fs.readFile(params.encryptedFilePath);
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface RestoreTestResult {
  ok: boolean;
  checksumMatches: boolean;
  restoredDatabaseUrl: string;
  durationMs: number;
}

/**
 * Decrypts a backup, verifies its checksum against the manifest, restores
 * it into a FRESH database (never overwriting anything live), and reports
 * how long the whole thing took — this is the measured restore-test spec
 * section 16 requires before any recovery-time number is trusted.
 * `superuserAdminUrl` is a separate, elevated connection used only to
 * create/drop the throwaway test database — deliberately not the app's own
 * runtime credentials.
 */
export async function restoreAndVerify(params: {
  encryptedFilePath: string;
  manifestPath: string;
  encryptionKeyHex: string;
  superuserAdminUrl: string;
  restoreDatabaseName: string;
  restoreOwnerRole: string;
  pgBinDir?: string;
  tmpDir: string;
}): Promise<RestoreTestResult> {
  const start = Date.now();

  const manifest = JSON.parse(await fs.readFile(params.manifestPath, "utf-8")) as { checksumSha256: string };
  const plaintext = await decryptBackup({
    encryptedFilePath: params.encryptedFilePath,
    encryptionKeyHex: params.encryptionKeyHex,
  });
  const checksumSha256 = crypto.createHash("sha256").update(plaintext).digest("hex");
  const checksumMatches = checksumSha256 === manifest.checksumSha256;

  await fs.mkdir(params.tmpDir, { recursive: true });
  const dumpPath = path.join(params.tmpDir, `restore-${Date.now()}.sql`);
  await fs.writeFile(dumpPath, plaintext);

  const pgPassword = extractPassword(params.superuserAdminUrl);
  const adminHost = new URL(params.superuserAdminUrl).hostname;
  const adminUser = new URL(params.superuserAdminUrl).username;

  await execFileAsync(
    pgBin(params.pgBinDir, "createdb"),
    ["-h", adminHost, "-U", adminUser, `--owner=${params.restoreOwnerRole}`, params.restoreDatabaseName],
    { env: { ...process.env, PGPASSWORD: pgPassword } },
  );

  const restoredDatabaseUrl = withDbName(params.superuserAdminUrl, params.restoreDatabaseName);

  try {
    await execFileAsync(
      pgBin(params.pgBinDir, "psql"),
      ["-h", adminHost, "-U", adminUser, "-d", params.restoreDatabaseName, "-f", dumpPath, "-v", "ON_ERROR_STOP=1"],
      { env: { ...process.env, PGPASSWORD: pgPassword } },
    );
  } finally {
    await fs.rm(dumpPath);
  }

  return { ok: checksumMatches, checksumMatches, restoredDatabaseUrl, durationMs: Date.now() - start };
}

export async function dropDatabase(params: {
  superuserAdminUrl: string;
  databaseName: string;
  pgBinDir?: string;
}): Promise<void> {
  const pgPassword = extractPassword(params.superuserAdminUrl);
  const adminHost = new URL(params.superuserAdminUrl).hostname;
  const adminUser = new URL(params.superuserAdminUrl).username;

  await execFileAsync(
    pgBin(params.pgBinDir, "dropdb"),
    ["-h", adminHost, "-U", adminUser, "--if-exists", params.databaseName],
    { env: { ...process.env, PGPASSWORD: pgPassword } },
  );
}
