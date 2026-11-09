import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";

export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const r2Configured = Boolean(
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_PUBLIC_URL,
);

const s3 = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
  : null;

export function isRemoteStorage(): boolean {
  return r2Configured;
}

/** The URL a stored file is reachable at — absolute (R2) or a backend-relative path (local disk). */
export function mediaUrl(storageKey: string): string {
  return s3 ? `${env.R2_PUBLIC_URL}/${storageKey}` : `/media/files/${storageKey}`;
}

/**
 * Saves an uploaded file's bytes to Cloudflare R2 when configured (required
 * on any host without a persistent disk — e.g. Render's free tier wipes
 * local disk on every restart), or to local disk otherwise (local dev).
 * Returns the URL to serve the file back from.
 */
export async function saveUploadedFile(storageKey: string, body: Buffer, mimeType: string): Promise<string> {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET!, Key: storageKey, Body: body, ContentType: mimeType }));
  } else {
    await writeFile(path.join(UPLOADS_DIR, storageKey), body);
  }
  return mediaUrl(storageKey);
}

export async function deleteUploadedFile(storageKey: string): Promise<void> {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET!, Key: storageKey })).catch(() => {});
    return;
  }
  await unlink(path.join(UPLOADS_DIR, storageKey)).catch(() => {});
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/**
 * Local-dev-only file serving for /media/files/:key — deliberately NOT
 * @fastify/static. That package's content-disposition dependency is
 * ESM-only, and even a dynamic import() of it gets inlined into an eager
 * require() by Vercel's bundler (esbuild resolves literal-string dynamic
 * imports at bundle time), crashing the deployed function at startup
 * whether or not the route is ever registered. This route is only ever
 * registered when isRemoteStorage() is false, so it's dead code in
 * production anyway — but staying off that package avoids the bundler
 * even tracing it.
 */
export function registerLocalFileRoute(app: FastifyInstance) {
  app.get("/media/files/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    // Reject path separators/traversal outright rather than relying only on
    // the resolved-path containment check below.
    if (key.includes("/") || key.includes("\\") || key.includes("..")) {
      return reply.code(400).send({ error: "invalid_key" });
    }
    const filePath = path.join(UPLOADS_DIR, key);
    if (path.dirname(filePath) !== UPLOADS_DIR) {
      return reply.code(400).send({ error: "invalid_key" });
    }
    try {
      const data = await readFile(filePath);
      const mimeType = MIME_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
      return reply.header("Content-Type", mimeType).send(data);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });
}
