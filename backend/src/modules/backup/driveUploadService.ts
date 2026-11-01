import fs from "node:fs";
import { google } from "googleapis";

/**
 * Uploads a backup's encrypted file + manifest to the business-owned Google
 * Drive folder (spec section 16's nightly copy).
 *
 * IMPORTANT: a bare service account cannot own files on a personal (non-
 * Workspace) Google Drive — Google gives service accounts zero storage
 * quota there (confirmed by hitting this in practice; see git history).
 * So this authenticates via OAuth2 as the OWNER'S OWN Google account
 * instead (one-time consent via scripts/driveOAuthSetup.ts, then a stored
 * refresh token), scoped to only `drive.file` (files this app created —
 * not the owner's whole Drive). If the business later moves to Google
 * Workspace, switch to a service account + Shared Drive instead, which
 * avoids depending on any individual's personal account/session.
 */
export interface DriveOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function buildOAuthClient(creds: DriveOAuthCredentials) {
  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  client.setCredentials({ refresh_token: creds.refreshToken });
  return client;
}

export async function uploadBackupToDrive(
  params: DriveOAuthCredentials & { folderId: string; filePaths: string[] },
): Promise<{ fileId: string; fileName: string }[]> {
  const auth = buildOAuthClient(params);
  const drive = google.drive({ version: "v3", auth });

  const uploaded: { fileId: string; fileName: string }[] = [];
  for (const filePath of params.filePaths) {
    const fileName = filePath.split(/[/\\]/).pop()!;
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [params.folderId] },
      media: { body: fs.createReadStream(filePath) },
      fields: "id,name",
    });
    uploaded.push({ fileId: res.data.id!, fileName: res.data.name! });
  }
  return uploaded;
}

export async function deleteDriveFile(params: DriveOAuthCredentials & { fileId: string }): Promise<void> {
  const auth = buildOAuthClient(params);
  const drive = google.drive({ version: "v3", auth });
  await drive.files.delete({ fileId: params.fileId });
}

/** Lists files in the backup folder — used by status checks and the restore runbook. */
export async function listDriveBackups(
  params: DriveOAuthCredentials & { folderId: string },
): Promise<{ fileId: string; fileName: string; createdTime: string | null | undefined; sizeBytes: string | null | undefined }[]> {
  const auth = buildOAuthClient(params);
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${params.folderId}' in parents and trashed = false`,
    fields: "files(id,name,createdTime,size)",
    orderBy: "createdTime desc",
  });
  return (res.data.files ?? []).map((f) => ({
    fileId: f.id!,
    fileName: f.name!,
    createdTime: f.createdTime,
    sizeBytes: f.size,
  }));
}
