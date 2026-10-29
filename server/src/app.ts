import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Logger } from "pino";
import { chatHandler, readDeviceId } from "./chat.js";
import { sendError } from "./http.js";
import type { Llm } from "./llm.js";

export interface AppDeps {
  llm: Llm;
  logger: Logger;
  corsOrigins?: string[];
  rateLimitPerMinute?: number;
}

function httpStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("status" in err)) return null;
  return typeof err.status === "number" ? err.status : null;
}

export function createApp({ llm, logger, corsOrigins = [], rateLimitPerMinute = 30 }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", requestId);
    const started = Date.now();
    res.on("finish", () => {
      logger.info(
        { requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started },
        "request",
      );
    });
    next();
  });

  // Health checks must not consume (or be blocked by) the chat rate limit.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(helmet());
  app.use(cors({ origin: corsOrigins }));

  app.use(
    "/v1",
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMinute,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: (req) => readDeviceId(req) ?? ipKeyGenerator(req.ip ?? ""),
      handler: (_req, res) => {
        sendError(res, 429, "rate_limited", "Too many requests.");
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.post("/v1/chat", chatHandler(llm, logger));

  app.use((_req, res) => {
    sendError(res, 404, "not_found", "Route not found.");
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = httpStatus(err);
    if (status === 413) {
      sendError(res, 413, "payload_too_large", "Request body is too large.");
    } else if (status !== null && status >= 400 && status < 500) {
      sendError(res, 400, "invalid_json", "Request body is not valid JSON.");
    } else {
      logger.error({ err }, "unhandled error");
      sendError(res, 500, "internal_error", "Something went wrong.");
    }
  };
  app.use(onError);

  return app;
}
