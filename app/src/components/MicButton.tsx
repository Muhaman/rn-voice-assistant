import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme";

export type MicState = "idle" | "listening" | "thinking" | "speaking";

interface Props {
  state: MicState;
  onPress: () => void;
}

const LABELS: Record<MicState, string> = {
  idle: "Start listening",
  listening: "Stop listening",
  thinking: "Thinking",
  speaking: "Stop speaking",
};

export function MicButton({ state, onPress }: Props) {
  const disabled = state === "thinking";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LABELS[state]}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, BUTTON_STYLES[state]]}
    >
      {state === "thinking" ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={state === "idle" ? styles.dot : styles.square} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  idle: { backgroundColor: colors.accent },
  listening: { backgroundColor: colors.listening },
  thinking: { backgroundColor: colors.busy },
  speaking: { backgroundColor: colors.speaking },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.text },
  square: { width: 26, height: 26, borderRadius: 6, backgroundColor: colors.text },
});

const BUTTON_STYLES = {
  idle: styles.idle,
  listening: styles.listening,
  thinking: styles.thinking,
  speaking: styles.speaking,
} as const;
