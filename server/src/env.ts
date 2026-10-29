import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z.string().default(""),
});

export interface Env {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  PORT: number;
  LOG_LEVEL: z.infer<typeof schema>["LOG_LEVEL"];
  corsOrigins: string[];
}

/** Validates the environment once at startup; the error names every offending variable. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment: ${problems.join("; ")}`);
  }
  const { CORS_ORIGINS, ...rest } = parsed.data;
  const corsOrigins = CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return { ...rest, corsOrigins };
}
