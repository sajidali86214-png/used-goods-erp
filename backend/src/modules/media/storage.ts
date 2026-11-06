import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
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
