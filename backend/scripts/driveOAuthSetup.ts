/**
 * One-time setup script: obtains a Google OAuth refresh token for the
 * backup-upload integration (spec section 16) under the OWNER'S OWN
 * Google account (not a service account, which has no Drive storage
 * quota — see backend/src/modules/backup/driveUploadService.ts).
 *
 * Run with: npx tsx scripts/driveOAuthSetup.ts
 * Requires GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.
 * Prints a URL to open in a browser; after approving, captures the
 * resulting token locally and appends GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
 * to .env. Never prints the refresh token itself to the console.
 */
import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET must be set in .env");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });

  console.log("\nOpen this URL in a browser and approve access:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the redirect to ${REDIRECT_URI} ...\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (code) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Authorization successful. You can close this tab and return to the terminal.");
        server.close();
        resolve(code);
        return;
      }
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("No code received.");
    });
    server.listen(PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token returned — if you've authorized this app before, revoke access at https://myaccount.google.com/permissions and run this script again (Google only issues a refresh_token on first consent).",
    );
  }

  const envPath = path.join(process.cwd(), ".env");
  const existing = fs.readFileSync(envPath, "utf-8");
  if (!existing.includes("GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN")) {
    fs.appendFileSync(envPath, `\nGOOGLE_DRIVE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token}"\n`);
    console.log("Saved GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN to .env (not printed here).");
  } else {
    console.log("GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN already present in .env — not overwritten. Remove it manually first if you want to re-run this.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
