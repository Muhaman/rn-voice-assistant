import { act, renderHook } from "@testing-library/react-native";

import { streamChat } from "../src/api/chat";
import { useChat } from "../src/hooks/useChat";

jest.mock("../src/api/chat", () => ({ streamChat: jest.fn() }));

const mockedStream = jest.mocked(streamChat);
const options = { apiUrl: "http://api.test", deviceId: "device-1" };

const summary = (messages: { role: string; content: string }[]) =>
  messages.map(({ role, content }) => [role, content]);

beforeEach(() => {
  mockedStream.mockReset();
});

describe("useChat", () => {
  it("concatenates streamed chunks into the last assistant message", async () => {
    mockedStream.mockImplementation(async (_url, _device, _messages, onText) => {
      onText("Hel");
      onText("lo");
    });
    const { result } = await renderHook(() => useChat(options));

    let reply: string | null = null;
    await act(async () => {
      reply = await result.current.send("Hi");
    });

    expect(summary(result.current.messages)).toEqual([
      ["user", "Hi"],
      ["assistant", "Hello"],
    ]);
    expect(reply).toBe("Hello");
    expect(result.current.busy).toBe(false);
  });

  it("sends the whole conversation with each request", async () => {
    mockedStream.mockImplementation(async (_url, _device, _messages, onText) => onText("ok"));
    const { result } = await renderHook(() => useChat(options));

    await act(async () => {
      await result.current.send("one");
    });
    await act(async () => {
      await result.current.send("two");
    });

    expect(mockedStream.mock.calls[1]?.[2]).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "two" },
    ]);
    expect(mockedStream.mock.calls[1]?.[1]).toBe("device-1");
  });

  it("drops the empty assistant message and exposes the error when the request fails", async () => {
    mockedStream.mockRejectedValue(new Error("The assistant is unavailable."));
    const { result } = await renderHook(() => useChat(options));

    let reply: string | null = "unset";
    await act(async () => {
      reply = await result.current.send("Hi");
    });

    expect(summary(result.current.messages)).toEqual([["user", "Hi"]]);
    expect(result.current.error).toBe("The assistant is unavailable.");
    expect(reply).toBeNull();
  });

  it("keeps the history alternating after a failed reply", async () => {
    mockedStream.mockRejectedValueOnce(new Error("down"));
    mockedStream.mockImplementation(async (_url, _device, _messages, onText) => onText("ok"));
    const { result } = await renderHook(() => useChat(options));

    await act(async () => {
      await result.current.send("lost question");
    });
    await act(async () => {
      await result.current.send("retry");
    });

    expect(mockedStream.mock.calls[1]?.[2]).toEqual([{ role: "user", content: "retry" }]);
  });

  it("starts the wire history with a user message once it is trimmed to 50", async () => {
    mockedStream.mockImplementation(async (_url, _device, _messages, onText) => onText("ok"));
    const { result } = await renderHook(() => useChat(options));

    for (let turn = 0; turn < 27; turn++) {
      await act(async () => {
        await result.current.send(`question ${turn}`);
      });
    }

    const wire = mockedStream.mock.calls[26]?.[2] ?? [];
    expect(wire.length).toBeLessThanOrEqual(50);
    expect(wire[0]?.role).toBe("user");
    expect(wire.at(-1)).toEqual({ role: "user", content: "question 26" });
    expect(wire.every((message, index) => message.role === (index % 2 === 0 ? "user" : "assistant"))).toBe(true);
  });

  it("ignores blank input", async () => {
    const { result } = await renderHook(() => useChat(options));

    await act(async () => {
      await result.current.send("   ");
    });

    expect(mockedStream).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });
});
