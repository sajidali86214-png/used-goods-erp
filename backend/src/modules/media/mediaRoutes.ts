import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "../../lib/prisma.js";
import { saveUploadedFile } from "./storage.js";

export { UPLOADS_DIR } from "./storage.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // plenty for a phone camera photo, not an open door for huge uploads

/**
 * Single-image upload used by every photo-taking flow (receiving/grading
 * condition shots, individual-item listing photos). Any authenticated user
 * can upload — the sensitive step is what the caller does with the
 * resulting mediaAssetId afterward (e.g. stock.transfer-gated individual
 * item separation), which already enforces its own permission.
 */
export async function mediaRoutes(app: FastifyInstance) {
  app.post("/media", async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ error: "unauthenticated" });

    const data = await request.file({ limits: { fileSize: MAX_SIZE_BYTES } });
    if (!data) return reply.code(400).send({ error: "no_file" });
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.code(400).send({ error: "unsupported_type", mimetype: data.mimetype });
    }

    const kindField = data.fields.kind as { value?: string } | undefined;
    const kind = kindField?.value ?? "attachment";

    const ext = path.extname(data.filename) || ".jpg";
    const storageKey = `${randomUUID()}${ext}`;

    const body = await data.toBuffer();
    if (data.file.truncated) {
      return reply.code(413).send({ error: "file_too_large", maxBytes: MAX_SIZE_BYTES });
    }

    const url = await saveUploadedFile(storageKey, body, data.mimetype);

    const asset = await prisma.mediaAsset.create({
      data: {
        kind,
        storageKey,
        mimeType: data.mimetype,
        sizeBytes: body.length,
        uploadedByUserId: request.authUser.id,
        uploadStatus: "complete",
      },
    });

    return reply.code(201).send({ ...asset, url });
  });
}
