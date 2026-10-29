import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { pino } from "pino";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { ClaudeLlm } from "./llm.js";

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL });

const app = createApp({
  llm: new ClaudeLlm(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.ANTHROPIC_MODEL),
  logger,
  corsOrigins: env.corsOrigins,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, model: env.ANTHROPIC_MODEL }, "server listening");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
