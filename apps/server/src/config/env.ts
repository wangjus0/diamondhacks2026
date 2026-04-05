import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  ELEVEN_LABS_API_KEY: z.string().min(1, "ELEVEN_LABS_API_KEY is required"),
  BROWSER_USE_API_KEY: z.string().min(1, "BROWSER_USE_API_KEY is required"),
  BROWSER_USE_PROFILE_ID: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL").optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NAVIGATION_ALLOWLIST: z.string().default("google.com,bing.com,duckduckgo.com"),
  ALLOW_FINAL_FORM_SUBMISSION: z.coerce.boolean().default(false),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
