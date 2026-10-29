import { act, renderHook } from "@testing-library/react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import { useVoice } from "../src/hooks/useVoice";

jest.mock("expo-speech-recognition");

const { emitSpeechEvent } = jest.requireMock<{
  emitSpeechEvent: (name: string, payload?: Record<string, unknown>) => void;
}>("expo-speech-recognition");

const speech = jest.mocked(ExpoSpeechRecognitionModule);

beforeEach(() => {
  jest.clearAllMocks();
  speech.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
});

const emit = (name: string, payload?: Record<string, unknown>) =>
  act(async () => {
    emitSpeechEvent(name, payload);
  });

describe("useVoice", () => {
  it("requests permission, starts recognition and tracks the transcript", async () => {
    const { result } = await renderHook(() => useVoice());

    await act(async () => {
      await result.current.start();
    });
    await emit("start");
    await emit("result", { results: [{ transcript: "what time is it" }], isFinal: true });

    expect(speech.start).toHaveBeenCalledWith(expect.objectContaining({ lang: "en-US", interimResults: true }));
    expect(result.current.state).toBe("listening");
    expect(result.current.transcript).toBe("what time is it");

    await emit("end");

    expect(result.current.state).toBe("idle");
    expect(result.current.transcript).toBe("what time is it");
  });

  it("reports an error and does not start when permission is denied", async () => {
    speech.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);
    const { result } = await renderHook(() => useVoice());

    await act(async () => {
      await result.current.start();
    });

    expect(speech.start).not.toHaveBeenCalled();
    expect(result.current.state).toBe("error");
  });

  it("enters the error state on a recognizer error but treats no-speech as idle", async () => {
    const { result } = await renderHook(() => useVoice());

    await emit("error", { error: "no-speech" });
    expect(result.current.state).toBe("idle");

    await emit("error", { error: "audio-capture" });
    await emit("end");
    expect(result.current.state).toBe("error");
  });

  it("stops recognition", async () => {
    const { result } = await renderHook(() => useVoice());

    result.current.stop();

    expect(speech.stop).toHaveBeenCalledTimes(1);
  });
});
