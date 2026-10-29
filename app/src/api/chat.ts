import { fetch } from "expo/fetch";

import { decodeChunks, parseSseStream } from "./sse";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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

  for await (const event of parseSseStream(decodeChunks(response.body.getReader()))) {
    if (event.type === "text") onText(event.text);
    else if (event.type === "error") throw new Error(event.message);
  }
}
