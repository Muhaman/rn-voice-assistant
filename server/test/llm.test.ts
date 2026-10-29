import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ClaudeLlm, LlmError, type StreamParams } from "../src/llm.js";

function stubClient(final: Record<string, unknown>) {
  const stream = vi.fn((_body: Record<string, unknown>, _options: { signal: AbortSignal }) => {
    const handlers: ((text: string) => void)[] = [];
    return {
      on: (_event: "text", handler: (text: string) => void) => handlers.push(handler),
      finalMessage: async () => {
        handlers.forEach((handler) => handler("Hello"));
        return final;
      },
    };
  });
  return { stream, client: { beta: { messages: { stream } } } as unknown as Anthropic };
}

const params = (): StreamParams => ({
  messages: [{ role: "user", content: "hi" }],
  signal: new AbortController().signal,
});

describe("ClaudeLlm.stream", () => {
  it("forwards text deltas and reports the stop reason", async () => {
    const { client } = stubClient({ stop_reason: "end_turn", stop_details: null });
    const onText = vi.fn();

    const result = await new ClaudeLlm(client, "claude-opus-5-5").stream(params(), onText);

    expect(onText).toHaveBeenCalledWith("Hello");
    expect(result).toEqual({ stopReason: "end_turn", refusalCategory: null });
  });

  it("reports the refusal category", async () => {
    const { client } = stubClient({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } });

    const result = await new ClaudeLlm(client, "claude-opus-5-5").stream(params(), vi.fn());

    expect(result).toEqual({ stopReason: "refusal", refusalCategory: "cyber" });
  });

  it("sends low effort, the history, and the abort signal", async () => {
    const { client, stream } = stubClient({ stop_reason: "end_turn", stop_details: null });
    const input = params();

    await new ClaudeLlm(client, "claude-opus-5-5").stream(input, vi.fn());

    const [body, options] = stream.mock.calls[0] ?? [];
    expect(body?.output_config).toEqual({ effort: "low" });
    expect(body?.messages).toEqual(input.messages);
    expect(body?.system).toEqual(expect.stringContaining("spoken"));
    expect(options?.signal).toBe(input.signal);
    for (const forbidden of ["temperature", "top_p", "top_k", "tool_choice"]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it.each(["claude-opus-5-5", "claude-sonnet-5-5"])("sends the server-side fallback for %s", async (model) => {
    const { client, stream } = stubClient({ stop_reason: "end_turn", stop_details: null });

    await new ClaudeLlm(client, model).stream(params(), vi.fn());

    const body = stream.mock.calls[0]?.[0];
    expect(body?.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body?.fallbacks).toBe("default");
  });

  it("omits fallback parameters for models without server-side fallback", async () => {
    const { client, stream } = stubClient({ stop_reason: "end_turn", stop_details: null });

    await new ClaudeLlm(client, "claude-haiku-5-5").stream(params(), vi.fn());

    const body = stream.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty("betas");
    expect(body).not.toHaveProperty("fallbacks");
  });

  it("maps SDK failures to a typed upstream_error", async () => {
    const client = {
      beta: {
        messages: {
          stream: () => ({
            on: () => undefined,
            finalMessage: async () => {
              throw new Anthropic.AnthropicError("boom");
            },
          }),
        },
      },
    } as unknown as Anthropic;

    const call = new ClaudeLlm(client, "claude-opus-5-5").stream(params(), vi.fn());

    await expect(call).rejects.toBeInstanceOf(LlmError);
    await expect(call).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("rethrows the original error when the caller aborted", async () => {
    const controller = new AbortController();
    const failure = new Error("aborted");
    const client = {
      beta: {
        messages: {
          stream: () => ({
            on: () => undefined,
            finalMessage: async () => {
              controller.abort();
              throw failure;
            },
          }),
        },
      },
    } as unknown as Anthropic;

    const call = new ClaudeLlm(client, "claude-opus-5-5").stream(
      { messages: [{ role: "user", content: "hi" }], signal: controller.signal },
      vi.fn(),
    );

    await expect(call).rejects.toBe(failure);
  });
});
