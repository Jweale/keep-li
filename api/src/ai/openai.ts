import type { SummarizeOutput } from "@keep-li/shared";
import { AiProviderError, type AiProvider, type SummarizeRequest } from "./provider";
import type { Logger } from "../utils/logger";

type OpenAIConfig = {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
};

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

const DEFAULT_MODEL = "gpt-4o-mini-2024-07-18";
const REQUEST_TIMEOUT_MS = 15000;
const VALID_INTENTS = new Set(["learn", "post_idea", "outreach", "research"]);

export const createOpenAIProvider = (config: OpenAIConfig): AiProvider => {
  if (!config.apiKey) {
    throw new AiProviderError("OpenAI API key missing", "unavailable");
  }
  return new OpenAIProvider(config);
};

class OpenAIProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger | null;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    // Bind fetch to globalThis to avoid "Illegal invocation" in Workers when called unbound
    this.fetchImpl = (config.fetchImpl ?? fetch).bind(globalThis);
    this.logger = config.logger ?? null;
  }

  async summarize(input: SummarizeRequest, options?: { signal?: AbortSignal }): Promise<SummarizeOutput> {
    const messages = buildMessages(input);
    let response: Response;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    if (options?.signal) {
      if (options.signal.aborted) {
        timeoutController.abort();
      } else {
        options.signal.addEventListener("abort", () => timeoutController.abort(), { once: true });
      }
    }

    try {
      response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: timeoutController.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages
        })
      });
    } catch (error) {
      const err = error as { name?: string; message?: string; stack?: string } | undefined;
      this.logger?.error("openai.fetch_failed", {
        name: err?.name ?? null,
        message: err?.message ?? (typeof error === "string" ? error : null),
        stack: typeof err?.stack === "string" ? err.stack.slice(0, 500) : undefined
      });
      if ((error as { name?: string }).name === "AbortError" || error instanceof DOMException) {
        throw new AiProviderError("OpenAI request timed out", "upstream_error");
      }
      throw new AiProviderError("OpenAI request failed", "upstream_error");
    } finally {
      clearTimeout(timeoutId);
    }

    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch (error) {
      this.logger?.error("openai.read_body_failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      throw new AiProviderError("Failed to read OpenAI response", "invalid_response");
    }

    if (!response.ok) {
      const bodySnippet = rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody || "<empty>";
      this.logger?.error("openai.response_error", {
        status: response.status,
        statusText: response.statusText,
        body: bodySnippet
      });
      throw new AiProviderError(
        `OpenAI responded with ${response.status}: ${bodySnippet}`,
        "upstream_error"
      );
    }

    let data: OpenAIChatCompletion;
    try {
      data = JSON.parse(rawBody) as OpenAIChatCompletion;
    } catch (error) {
      const snippet = rawBody ? (rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody) : "<empty>";
      this.logger?.error("openai.invalid_json", {
        body: snippet,
        message: error instanceof Error ? error.message : String(error)
      });
      throw new AiProviderError("Failed to parse OpenAI response", "invalid_response");
    }

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new AiProviderError("OpenAI response missing content", "invalid_response");
    }

    const parsed = parseStructuredContent(rawContent);
    const summary = normaliseSummary(parsed.summary_160);
    const tags = normaliseTags(parsed.tags);
    const intent = normaliseIntent(parsed.intent);
    const nextAction = typeof parsed.next_action === "string" ? parsed.next_action.trim() : "";

    this.logger?.info("openai.summarize_succeeded", {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0
    });

    return {
      summary_160: summary,
      tags,
      intent,
      next_action: nextAction,
      tokens_in: data.usage?.prompt_tokens ?? 0,
      tokens_out: data.usage?.completion_tokens ?? 0
    } satisfies SummarizeOutput;
  }
}

type ParsedContent = {
  summary_160?: string;
  tags?: unknown;
  intent?: unknown;
  next_action?: unknown;
};

function buildMessages(input: SummarizeRequest): OpenAIChatMessage[] {
  const segments: string[] = [`URL: ${input.url}`];
  if (input.highlight) {
    segments.push(`Highlight:\n${input.highlight}`);
  }
  if (input.post_content) {
    segments.push(`Post content:\n${input.post_content}`);
  }
  const userContent = segments.join("\n\n");

  return [
    {
      role: "system",
      content:
        "You summarise LinkedIn posts. Respond with JSON format: {\n" +
        '  "summary_160": string (<=160 chars, plain text),\n' +
        '  "tags": array of <=5 short lowercase keywords,\n' +
        '  "intent": one of ["learn","post_idea","outreach","research"],\n' +
        '  "next_action": concise next step suggestion.\n' +
        "Do not include commentary outside the JSON."
    },
    {
      role: "user",
      content: userContent
    }
  ];
}

function parseStructuredContent(content: string): ParsedContent {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as ParsedContent;
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as ParsedContent;
      } catch {
        throw new AiProviderError("Malformed JSON from OpenAI", "invalid_response");
      }
    }
    throw new AiProviderError("OpenAI response was not JSON", "invalid_response");
  }
}

function normaliseSummary(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 160) {
    return cleaned;
  }
  return cleaned.slice(0, 160).trimEnd();
}

function normaliseTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalised = item.trim().toLowerCase();
    if (!normalised || normalised.length > 24 || seen.has(normalised)) {
      continue;
    }
    seen.add(normalised);
    tags.push(normalised);
    if (tags.length >= 5) {
      break;
    }
  }
  return tags;
}

function normaliseIntent(value: unknown): "learn" | "post_idea" | "outreach" | "research" {
  if (typeof value !== "string") {
    return "learn";
  }
  const candidate = value.trim().toLowerCase();
  if (VALID_INTENTS.has(candidate)) {
    return candidate as typeof candidate & ("learn" | "post_idea" | "outreach" | "research");
  }
  return "learn";
}
