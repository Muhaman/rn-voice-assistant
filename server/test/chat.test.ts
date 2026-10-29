import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../src/app.js";
import { LlmError } from "../src/llm.js";
import { DEVICE_ID, FakeLlm, parseSse, postChat, reply, startServer } from "./fakes.js";

const messages = [{ role: "user", content: "What is the capital of France?" }];

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function boot(llm: FakeLlm, overrides: Partial<AppDeps> = {}) {
  const server = await startServer(llm, overrides);
  close = server.close;
  return server.url;
}

describe("POST /v1/chat", () => {
  it("streams text events followed by done", async () => {
    const llm = new FakeLlm(reply("Paris", " it is."));
    const url = await boot(llm);

    const res = await postChat(url, { messages });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(parseSse(await res.text())).toEqual([
      { event: "text", data: { text: "Paris" } },
      { event: "text", data: { text: " it is." } },
      { event: "done", data: {} },
    ]);
    expect(llm.calls[0]?.messages).toEqual(messages);
  });

  it("rejects more than 50 messages with 400", async () => {
    const url = await boot(new FakeLlm(reply("x")));
    const many = Array.from({ length: 51 }, () => ({ role: "user", content: "hi" }));

    const res = await postChat(url, { messages: many });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects empty and oversized message content with 400", async () => {
    const url = await boot(new FakeLlm(reply("x")));

    expect((await postChat(url, { messages: [{ role: "user", content: "" }] })).status).toBe(400);
    expect((await postChat(url, { messages: [{ role: "user", content: "a".repeat(4001) }] })).status).toBe(400);
  });

  it("rejects a conversation that does not start with a user message with 400", async () => {
    const llm = new FakeLlm(reply("x"));
    const url = await boot(llm);

    const res = await postChat(url, {
      messages: [
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Hi" },
      ],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request", message: expect.stringContaining("first message") } });
    expect(llm.calls).toHaveLength(0);
  });

  it("rejects a missing x-device-id with 400", async () => {
    const url = await boot(new FakeLlm(reply("x")));

    const res = await postChat(url, { messages }, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects an x-device-id that is not a uuid with 400", async () => {
    const url = await boot(new FakeLlm(reply("x")));

    const res = await postChat(url, { messages }, { "x-device-id": "not-a-uuid" });

    expect(res.status).toBe(400);
  });

  it("aborts the upstream request when the client disconnects mid-stream", async () => {
    let upstream: AbortSignal | undefined;
    const llm = new FakeLlm(async (params, onText) => {
      upstream = params.signal;
      onText("Par");
      await new Promise<void>((resolve) => params.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { stopReason: null, refusalCategory: null };
    });
    const url = await boot(llm);

    const res = await postChat(url, { messages });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() => expect(upstream?.aborted).toBe(true));
  });

  it("emits an error event when the model refuses", async () => {
    const llm = new FakeLlm(async () => ({ stopReason: "refusal", refusalCategory: "cyber" }));
    const url = await boot(llm);

    const res = await postChat(url, { messages });

    expect(res.status).toBe(200);
    expect(parseSse(await res.text())).toEqual([
      { event: "error", data: { code: "refusal", message: expect.any(String) } },
    ]);
  });

  it("emits an error event when the reply hits max_tokens", async () => {
    const llm = new FakeLlm(async (_params, onText) => {
      onText("Long ans");
      return { stopReason: "max_tokens", refusalCategory: null };
    });
    const url = await boot(llm);

    const events = parseSse(await (await postChat(url, { messages })).text());

    expect(events.at(-1)).toEqual({ event: "error", data: { code: "max_tokens", message: expect.any(String) } });
  });

  it("emits an error event instead of an empty reply", async () => {
    const llm = new FakeLlm(async () => ({ stopReason: "end_turn", refusalCategory: null }));
    const url = await boot(llm);

    const events = parseSse(await (await postChat(url, { messages })).text());

    expect(events).toEqual([{ event: "error", data: { code: "empty_response", message: expect.any(String) } }]);
  });

  it("emits the typed code when the LLM wrapper fails", async () => {
    const llm = new FakeLlm(async () => {
      throw new LlmError("upstream_error", "Upstream model request failed.");
    });
    const url = await boot(llm);

    const events = parseSse(await (await postChat(url, { messages })).text());

    expect(events).toEqual([{ event: "error", data: { code: "upstream_error", message: "Upstream model request failed." } }]);
  });

  it("answers 429 JSON after the per-device limit and keeps /healthz open", async () => {
    const url = await boot(new FakeLlm(reply("ok")), { rateLimitPerMinute: 2 });

    expect((await postChat(url, { messages })).status).toBe(200);
    expect((await postChat(url, { messages })).status).toBe(200);
    const limited = await postChat(url, { messages });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: { code: "rate_limited", message: "Too many requests." } });
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it("limits each device id separately", async () => {
    const url = await boot(new FakeLlm(reply("ok")), { rateLimitPerMinute: 1 });
    const other = "7c1f0d3a-2b4e-4f6a-8a9b-1c2d3e4f5a6b";

    expect((await postChat(url, { messages })).status).toBe(200);
    expect((await postChat(url, { messages }, { "x-device-id": other })).status).toBe(200);
    expect((await postChat(url, { messages }, { "x-device-id": DEVICE_ID })).status).toBe(429);
  });

  it("rejects malformed JSON with 400 JSON error", async () => {
    const url = await boot(new FakeLlm(reply("x")));

    const res = await fetch(`${url}/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": DEVICE_ID },
      body: "{nope",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_json" } });
  });
});

describe("GET /healthz", () => {
  it("returns ok with an x-request-id header", async () => {
    const url = await boot(new FakeLlm(reply("x")));

    const res = await fetch(`${url}/healthz`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});
