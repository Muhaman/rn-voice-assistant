import { fetch } from "expo/fetch";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function readField(json: string, key: string): string | null {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

async function failureMessage(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") return message;
  } catch {
    // Not a JSON error body; fall through to the generic message.
  }
  return `The assistant is unavailable (HTTP ${response.status}).`;
}

/** Splits an SSE buffer into complete blocks plus the unfinished remainder. */
function splitBlocks(buffer: string): { blocks: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  return { blocks: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

/**
 * Streams a reply from the proxy. `onText` receives each text delta; the promise resolves when the
 * server sends `done` and rejects on an `error` event, a failed request, or an early disconnect.
 */
export async function streamChat(
  apiUrl: string,
  deviceId: string,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-device-id": deviceId },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!response.ok) throw new Error(await failureMessage(response));
  if (!response.body) throw new Error("The assistant returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { blocks, rest } = splitBlocks(buffer);
    buffer = rest;

    for (const block of blocks) {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "{}";
      if (event === "text") onText(readField(data, "text") ?? "");
      else if (event === "done") finished = true;
      else if (event === "error") throw new Error(readField(data, "message") ?? "The assistant failed.");
    }
  }

  if (!finished) throw new Error("The connection closed before the reply finished.");
}
