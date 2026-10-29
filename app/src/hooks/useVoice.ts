import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useState } from "react";

export type VoiceState = "idle" | "listening" | "error";

// Silence and a deliberate stop are normal ends of a turn, not failures.
const BENIGN_ERRORS = new Set<string>(["no-speech", "aborted"]);

export function useVoice() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");

  useSpeechRecognitionEvent("start", () => setState("listening"));
  useSpeechRecognitionEvent("end", () => setState((current) => (current === "error" ? current : "idle")));
  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript;
    if (text !== undefined) setTranscript(text);
  });
  useSpeechRecognitionEvent("error", (event) => setState(BENIGN_ERRORS.has(event.error) ? "idle" : "error"));

  const start = useCallback(async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setState("error");
      return;
    }
    setTranscript("");
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { state, transcript, start, stop };
}
