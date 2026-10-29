import Anthropic from "@anthropic-ai/sdk";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamParams {
  messages: ChatMessage[];
  signal: AbortSignal;
}

export interface LlmResult {
  stopReason: string | null;
  refusalCategory: string | null;
}

export interface Llm {
  /** Streams the reply through `onText`; resolves once the model has stopped. */
  stream(params: StreamParams, onText: (text: string) => void): Promise<LlmResult>;
}

/** A model-side failure with a stable code the route can surface to clients. */
export class LlmError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const SYSTEM_PROMPT =
  "You are a voice assistant. Your answers are read aloud by a text-to-speech engine, so write the way people speak: " +
  "one to three short sentences, plain words, no markdown, lists, headings, emoji or URLs. " +
  "If a question needs a long answer, give the key point and offer to continue.";

const MAX_TOKENS = 4096;
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export class ClaudeLlm implements Llm {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async stream({ messages, signal }: StreamParams, onText: (text: string) => void): Promise<LlmResult> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        output_config: { effort: "low" },
        // Server-side refusal fallback exists only on some models; other models would reject it.
        ...(FALLBACK_MODELS.has(this.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    stream.on("text", onText);

    try {
      const message = await stream.finalMessage();
      return { stopReason: message.stop_reason, refusalCategory: message.stop_details?.category ?? null };
    } catch (err) {
      if (signal.aborted || !(err instanceof Anthropic.AnthropicError)) throw err;
      throw new LlmError("upstream_error", "The model request failed.");
    }
  }
}
