import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be set — see backend/.env.example"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be set to a long random value"),
  PORT: z.coerce.number().default(3000),
  // Comma-separated list of allowed browser origins (admin-web, mobile web views, etc).
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  // Photo storage: when ALL four R2_* vars are set, uploads go to Cloudflare
  // R2 (needed on any host without a persistent disk, e.g. Render's free
  // tier). Left unset, uploads fall back to local disk — fine for local dev.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(), // the bucket's public base URL (r2.dev or a custom domain)
});

export const env = envSchema.parse(process.env);
