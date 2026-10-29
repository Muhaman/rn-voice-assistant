export type ServerEvent =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export class MalformedEventError extends Error {
  constructor(detail: string) {
    super(`Malformed event from the assistant: ${detail}`);
    this.name = "MalformedEventError";
  }
}

function readStringField(json: string, key: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new MalformedEventError("data is not valid JSON");
  }
  const field = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  if (typeof field !== "string") throw new MalformedEventError(`missing "${key}"`);
  return field;
}

/**
 * Parses one SSE block (lines between blank lines, already `\n`-normalised). Comment lines and
 * events the client does not know are ignored (null). Multiple `data:` lines join with `\n`.
 */
export function parseSseBlock(block: string): ServerEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  const payload = data.join("\n");
  switch (event) {
    case "text":
      return { type: "text", text: readStringField(payload, "text") };
    case "error":
      return { type: "error", message: readStringField(payload, "message") };
    case "done":
      return { type: "done" };
    default:
      return null;
  }
}

/**
 * Turns decoded text chunks into events. Rejects with MalformedEventError on bad payloads and with a
 * plain Error when the stream ends before a `done` or `error` event.
 */
export async function* parseSseStream(chunks: AsyncIterable<string>): AsyncGenerator<ServerEvent> {
  let buffer = "";
  let terminated = false;

  for await (const chunk of chunks) {
    // Normalise the whole buffer so a CRLF split across two chunks is still joined.
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const block of parts) {
      const event = parseSseBlock(block);
      if (!event) continue;
      if (event.type !== "text") terminated = true;
      yield event;
    }
  }

  if (!terminated) throw new Error("The connection closed before the reply finished.");
}

/** Decodes a byte stream and always releases the reader, including when the consumer throws. */
export async function* decodeChunks(
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel">,
  decoder: Pick<TextDecoder, "decode"> = new TextDecoder(),
): AsyncGenerator<string> {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
