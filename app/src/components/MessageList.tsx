import { memo, useRef } from "react";
import { FlatList, StyleSheet, Text, View, type ListRenderItem } from "react-native";

import type { Message } from "../hooks/useChat";
import { colors, fontSize, radius, spacing } from "../theme";

interface Props {
  messages: Message[];
}

const Bubble = memo(function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <View testID="message" style={[styles.bubble, isUser ? styles.user : styles.assistant]}>
      <Text style={styles.text}>{message.content}</Text>
    </View>
  );
});

const renderItem: ListRenderItem<Message> = ({ item }) => <Bubble message={item} />;
const keyExtractor = (message: Message) => message.id;

export function MessageList({ messages }: Props) {
  const listRef = useRef<FlatList<Message>>(null);
  return (
    <FlatList
      ref={listRef}
      data={messages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.content}
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      ListEmptyComponent={<Text style={styles.hint}>Tap the microphone and ask something.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubble: {
    maxWidth: "85%",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.bubble,
  },
  user: { alignSelf: "flex-end", backgroundColor: colors.userBubble },
  assistant: { alignSelf: "flex-start", backgroundColor: colors.assistantBubble },
  text: { color: colors.text, fontSize: fontSize.body, lineHeight: 22 },
  hint: { color: colors.mutedText, fontSize: fontSize.body, textAlign: "center", marginTop: spacing.lg },
});
