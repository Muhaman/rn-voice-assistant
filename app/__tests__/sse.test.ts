import { decodeChunks, MalformedEventError, parseSseBlock, parseSseStream, type ServerEvent } from "../src/api/sse";

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

async function collect(chunks: string[]): Promise<ServerEvent[]> {
  const events: ServerEvent[] = [];
  for await (const event of parseSseStream(fromChunks(chunks))) events.push(event);
  return events;
}

const text = (value: string): ServerEvent => ({ type: "text", text: value });
const done: ServerEvent = { type: "done" };

describe("parseSseStream", () => {
  it.each<[string, string[], ServerEvent[]]>([
    [
      "an event split across chunks",
      ['event: text\nda', 'ta: {"text":"Hel"}\n\nevent: text\ndata: {"text":"lo"}\n\nevent: done\ndata: {}\n\n'],
      [text("Hel"), text("lo"), done],
    ],
    [
      "a CRLF stream",
      ['event: text\r\ndata: {"text":"Hi"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n'],
      [text("Hi"), done],
    ],
    [
      "a CRLF pair split between chunks",
      ['event: text\r', '\ndata: {"text":"Hi"}\r\n\r', "\nevent: done\r\ndata: {}\r\n\r\n"],
      [text("Hi"), done],
    ],
    [
      "multi-line data joined with a newline",
      ['event: text\ndata: {"text":\ndata: "Hi"}\n\nevent: done\ndata: {}\n\n'],
      [text("Hi"), done],
    ],
    [
      "comment lines and unknown events",
      [': keep-alive\n\nevent: ping\ndata: {}\n\nevent: text\n: note\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n'],
      [text("Hi"), done],
    ],
    [
      "an error event, which ends the stream without done",
      ['event: text\ndata: {"text":"Par"}\n\nevent: error\ndata: {"code":"refusal","message":"Declined."}\n\n'],
      [text("Par"), { type: "error", message: "Declined." }],
    ],
  ])("yields the events of %s", async (_name, chunks, expected) => {
    await expect(collect(chunks)).resolves.toEqual(expected);
  });

  it("rejects when the stream ends without done", async () => {
    await expect(collect(['event: text\ndata: {"text":"Hi"}\n\n'])).rejects.toThrow(/closed before the reply finished/);
  });

  it("rejects when the final event is cut off mid-block", async () => {
    await expect(collect(['event: text\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}'])).rejects.toThrow(
      /closed before/,
    );
  });

  it.each([
    ["invalid JSON", "event: text\ndata: {nope\n\n"],
    ["a missing text field", 'event: text\ndata: {"other":1}\n\n'],
    ["a non-string message", 'event: error\ndata: {"message":5}\n\n'],
  ])("rejects with MalformedEventError on %s", async (_name, chunk) => {
    await expect(collect([chunk])).rejects.toBeInstanceOf(MalformedEventError);
  });
});

describe("parseSseBlock", () => {
  it("ignores a block with only comments", () => {
    expect(parseSseBlock(": ping")).toBeNull();
  });

  it("accepts data without the optional space after the colon", () => {
    expect(parseSseBlock('event:text\ndata:{"text":"Hi"}')).toEqual(text("Hi"));
  });
});

describe("decodeChunks", () => {
  const decoder = { decode: (bytes?: Uint8Array) => String.fromCharCode(...(bytes ?? [])) };
  const bytes = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));

  function fakeReader(...chunks: string[]) {
    const queue = chunks.map(bytes);
    return {
      read: jest.fn(async () => {
        const value = queue.shift();
        return value ? { done: false as const, value } : { done: true as const, value: undefined };
      }),
      cancel: jest.fn(async () => undefined),
    };
  }

  it("decodes chunks and releases the reader when the stream ends", async () => {
    const reader = fakeReader("a", "b");
    const decoded: string[] = [];

    for await (const chunk of decodeChunks(reader, decoder)) decoded.push(chunk);

    expect(decoded).toEqual(["a", "b"]);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("releases the reader when the consumer throws", async () => {
    const reader = fakeReader("event: text\ndata: {nope\n\n", "more");

    await expect(collectFrom(reader)).rejects.toBeInstanceOf(MalformedEventError);

    expect(reader.cancel).toHaveBeenCalledTimes(1);

    async function collectFrom(source: ReturnType<typeof fakeReader>) {
      for await (const _event of parseSseStream(decodeChunks(source, decoder))) {
        // Consume until the parser throws.
      }
    }
  });
});
