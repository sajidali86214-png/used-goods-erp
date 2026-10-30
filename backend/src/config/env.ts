import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL must be set — see backend/.env.example"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be set to a long random value"),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);
