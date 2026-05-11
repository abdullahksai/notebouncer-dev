// Centralized env loading + validation. Crashing at startup with a clear
// message beats hitting a vague "undefined" deep in a request handler.

import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  // Server
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Database / crypto
  DATABASE_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1, "TOKEN_ENCRYPTION_KEY is required"),

  // Zoom Marketplace credentials
  ZOOM_CLIENT_ID: z.string().min(1),
  ZOOM_CLIENT_SECRET: z.string().min(1),
  ZOOM_WEBHOOK_SECRET: z.string().min(1),
  ZOOM_REDIRECT_URI: z.string().url(),

  // Where to bounce the user after OAuth completes (frontend dashboard).
  FRONTEND_URL: z.string().url(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
