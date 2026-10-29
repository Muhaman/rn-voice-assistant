import type { Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";
import { sendError } from "./http.js";
import { LlmError, type Llm } from "./llm.js";

export const chatBodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(50),
});

const deviceIdSchema = z.uuid();

/** The rate-limit key and request validator share this: only a well-formed uuid identifies a device. */
export function readDeviceId(req: Request): string | null {
  const parsed = deviceIdSchema.safeParse(req.get("x-device-id"));
  return parsed.success ? parsed.data : null;
}

function writeEvent(res: Response, event: "text" | "done" | "error", data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function chatHandler(llm: Llm, logger: Logger): RequestHandler {
  return async (req, res) => {
    if (!readDeviceId(req)) {
      sendError(res, 400, "invalid_request", "x-device-id header must be a uuid.");
      return;
    }
    const body = chatBodySchema.safeParse(req.body);
    if (!body.success) {
      const problems = body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      sendError(res, 400, "invalid_request", problems.join("; "));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    let produced = false;
    try {
      const result = await llm.stream({ messages: body.data.messages, signal: controller.signal }, (text) => {
        produced = true;
        writeEvent(res, "text", { text });
      });

      if (result.stopReason === "refusal") {
        logger.warn({ category: result.refusalCategory }, "model refused");
        writeEvent(res, "error", { code: "refusal", message: "The assistant can't help with that request." });
      } else if (result.stopReason === "max_tokens") {
        writeEvent(res, "error", { code: "max_tokens", message: "The reply was cut off." });
      } else if (!produced) {
        writeEvent(res, "error", { code: "empty_response", message: "The assistant returned no answer." });
      } else {
        writeEvent(res, "done", {});
      }
    } catch (err) {
      if (controller.signal.aborted) {
        logger.info("client disconnected; upstream request aborted");
      } else {
        logger.error({ err }, "chat stream failed");
        const failure =
          err instanceof LlmError ? err : new LlmError("internal_error", "Something went wrong.");
        writeEvent(res, "error", { code: failure.code, message: failure.message });
      }
    } finally {
      res.end();
    }
  };
}
