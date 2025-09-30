export type Intent = "learn" | "post_idea" | "outreach" | "research";

export type Status = "inbox" | "to_use" | "archived";

export interface SummarizeInput {
  url: string;
  title?: string;
  highlight?: string;
  licenseKey?: string;
}

export interface SummarizeOutput {
  summary_160: string;
  tags: string[];
  intent: Intent;
  next_action: string;
  tokens_in: number;
  tokens_out: number;
}

export interface SheetRowInput {
  date_added: string;
  source: "linkedin" | "web";
  url: string;
  title: string;
  highlight?: string;
  summary_160?: string;
  tags?: string[];
  intent?: Intent;
  next_action?: string;
  status: Status;
  url_hash: string;
  notes?: string;
}

export interface SavedPost {
  urlHash: string;
  url: string;
  title: string;
  timestamp: number;
}

export interface ExtensionConfig {
  apiEndpoint: string;
  sheetsApiEndpoint: string;
  environment: "development" | "production";
}

export interface KeyValueNamespace {
  get(key: string, options?: unknown): Promise<string | null>;
  put(key: string, value: string, options?: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkerEnv {
  KV: KeyValueNamespace;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  SENTRY_DSN?: string;
}
