import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadBackupToDrive, listDriveBackups, deleteDriveFile } from "../src/modules/backup/driveUploadService.js";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
const canRun = !!clientId && !!clientSecret && !!refreshToken && !!folderId;

/**
 * Exercises the real Google Drive integration (spec section 16's nightly
 * copy) — not mocked. Skips cleanly wherever OAuth isn't configured,
 * rather than failing or faking success.
 */
describe.skipIf(!canRun)("Google Drive backup upload (real API)", () => {
  it("uploads a file to the shared folder, lists it, and cleans it up", async () => {
    const creds = { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
    const tmpFile = path.join(os.tmpdir(), `erp-drive-test-${randomUUID()}.txt`);
    const marker = `test-upload-${randomUUID()}`;
    fs.writeFileSync(tmpFile, marker);

    const uploaded = await uploadBackupToDrive({ ...creds, folderId: folderId!, filePaths: [tmpFile] });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.fileName).toBe(path.basename(tmpFile));

    const listing = await listDriveBackups({ ...creds, folderId: folderId! });
    expect(listing.some((f) => f.fileId === uploaded[0]!.fileId)).toBe(true);

    await deleteDriveFile({ ...creds, fileId: uploaded[0]!.fileId });
    const listingAfterDelete = await listDriveBackups({ ...creds, folderId: folderId! });
    expect(listingAfterDelete.some((f) => f.fileId === uploaded[0]!.fileId)).toBe(false);

    fs.rmSync(tmpFile);
  }, 30000);
});
