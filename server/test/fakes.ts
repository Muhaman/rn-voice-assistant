import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { createApp, type AppDeps } from "../src/app.js";
import type { Llm, LlmResult, StreamParams } from "../src/llm.js";

export const DEVICE_ID = "0b5f6f9e-6a63-4c55-9d4c-3f6f2f9f6a11";

export type Script = (params: StreamParams, onText: (text: string) => void) => Promise<LlmResult>;

export const reply =
  (...chunks: string[]): Script =>
  async (_params, onText) => {
    chunks.forEach(onText);
    return { stopReason: "end_turn", refusalCategory: null };
  };

/** Plays a script per call and records every call's params. */
export class FakeLlm implements Llm {
  readonly calls: StreamParams[] = [];

  constructor(private readonly script: Script) {}

  stream(params: StreamParams, onText: (text: string) => void): Promise<LlmResult> {
    this.calls.push(params);
    return this.script(params, onText);
  }
}

export async function startServer(llm: Llm, overrides: Partial<AppDeps> = {}) {
  const app = createApp({ llm, logger: pino({ level: "silent" }), ...overrides });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function postChat(url: string, body: unknown, headers: Record<string, string> = { "x-device-id": DEVICE_ID }) {
  return fetch(`${url}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSse(raw: string): SseEvent[] {
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "null";
      return { event, data: JSON.parse(data) as unknown };
    });
}
