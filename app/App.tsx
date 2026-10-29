import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Speech from "expo-speech";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { MessageList } from "./src/components/MessageList";
import { MicButton, type MicState } from "./src/components/MicButton";
import { useChat } from "./src/hooks/useChat";
import { useVoice } from "./src/hooks/useVoice";
import { colors, fontSize, spacing } from "./src/theme";

function readApiUrl(): string {
  const url: unknown = Constants.expoConfig?.extra?.apiUrl;
  if (typeof url !== "string" || url === "") throw new Error("Set expo.extra.apiUrl in app.json.");
  return url;
}

const API_URL = readApiUrl();

export default function App() {
  const [deviceId] = useState(() => randomUUID());
  const [speaking, setSpeaking] = useState(false);
  const chat = useChat({ apiUrl: API_URL, deviceId });
  const voice = useVoice();
  const { send } = chat;

  const ask = useCallback(
    async (question: string) => {
      const reply = await send(question);
      if (!reply) return;
      const finish = () => setSpeaking(false);
      setSpeaking(true);
      Speech.speak(reply, { language: "en-US", onDone: finish, onStopped: finish, onError: finish });
    },
    [send],
  );

  // A listening session that ends with a transcript is the user's question.
  const previousVoiceState = useRef(voice.state);
  useEffect(() => {
    if (previousVoiceState.current === "listening" && voice.state === "idle" && voice.transcript) {
      void ask(voice.transcript);
    }
    previousVoiceState.current = voice.state;
  }, [voice.state, voice.transcript, ask]);

  useEffect(() => () => void Speech.stop(), []);

  const micState: MicState = speaking
    ? "speaking"
    : chat.busy
      ? "thinking"
      : voice.state === "listening"
        ? "listening"
        : "idle";

  const onMicPress = () => {
    if (micState === "idle") void voice.start();
    else if (micState === "listening") voice.stop();
    else if (micState === "speaking") void Speech.stop();
  };

  const problem =
    chat.error ?? (voice.state === "error" ? "Speech recognition is unavailable. Check microphone permissions." : null);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.list}>
          <MessageList messages={chat.messages} />
        </View>
        <View style={styles.footer}>
          {voice.state === "listening" && voice.transcript ? (
            <Text style={styles.transcript}>{voice.transcript}</Text>
          ) : null}
          {problem ? <Text style={styles.error}>{problem}</Text> : null}
          <MicButton state={micState} onPress={onMicPress} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  footer: { alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface },
  transcript: { color: colors.mutedText, fontSize: fontSize.body, textAlign: "center" },
  error: { color: colors.error, fontSize: fontSize.caption, textAlign: "center" },
});
