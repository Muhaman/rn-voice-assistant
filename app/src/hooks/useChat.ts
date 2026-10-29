import { useCallback, useEffect, useRef, useState } from "react";

import { streamChat, type ChatMessage } from "../api/chat";

export interface Message extends ChatMessage {
  id: string;
}

interface Options {
  apiUrl: string;
  deviceId: string;
}

const MAX_HISTORY = 50;

/**
 * Builds a history the API accepts: roles alternate (a user turn whose reply failed is superseded by
 * the next user turn) and the first message is from the user, even after trimming to the last 50.
 */
export function toWire(messages: Message[]): ChatMessage[] {
  const alternating: ChatMessage[] = [];
  for (const { role, content } of messages) {
    if (alternating.at(-1)?.role === role) alternating.pop();
    alternating.push({ role, content });
  }
  const recent = alternating.slice(-MAX_HISTORY);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

export function useChat({ apiUrl, deviceId }: Options) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  const commit = useCallback((next: Message[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  useEffect(() => cancel, [cancel]);

  /** Sends one user turn; resolves with the full reply, or null if blank, busy, failed or cancelled. */
  const send = useCallback(
    async (text: string): Promise<string | null> => {
      const content = text.trim();
      if (!content || controllerRef.current) return null;

      const controller = new AbortController();
      controllerRef.current = controller;
      const userMessage: Message = { id: String(idRef.current++), role: "user", content };
      const assistantId = String(idRef.current++);
      const history = [...messagesRef.current, userMessage];
      commit([...history, { id: assistantId, role: "assistant", content: "" }]);
      setBusy(true);
      setError(null);

      let reply = "";
      let completed = false;
      try {
        await streamChat(
          apiUrl,
          deviceId,
          toWire(history),
          (chunk) => {
            reply += chunk;
            commit([...history, { id: assistantId, role: "assistant", content: reply }]);
          },
          controller.signal,
        );
        completed = true;
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      } finally {
        // An empty assistant turn is invalid history for the next request.
        if (reply === "") commit(history);
        controllerRef.current = null;
        setBusy(false);
      }
      return completed ? reply : null;
    },
    [apiUrl, deviceId, commit],
  );

  return { messages, busy, error, send, cancel };
}
