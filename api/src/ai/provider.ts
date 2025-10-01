import type { SummarizeInput, SummarizeOutput } from "@keep-li/shared";

export type SummarizeRequest = Pick<SummarizeInput, "url" | "post_content" | "highlight">;

export interface AiProvider {
  summarize(input: SummarizeRequest, options?: { signal?: AbortSignal }): Promise<SummarizeOutput>;
}

export class AiProviderError extends Error {
  readonly code: "unavailable" | "invalid_response" | "upstream_error";

  constructor(message: string, code: AiProviderError["code"]) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
  }
}
