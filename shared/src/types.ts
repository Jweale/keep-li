export type Intent = "learn" | "post_idea" | "outreach" | "research";

export type Status = "inbox" | "to_use" | "archived";

export interface SummarizeInput {
  url: string;
  post_content?: string;
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

export interface SheetRow {
  timestamp: string;
  url: string;
  urlId: string;
  post_content: string;
  authorName: string | null;
  authorHeadline: string | null;
  authorCompany: string | null;
  authorUrl: string | null;
  selection: string | null;
  status: Status;
  summary: string | null;
}

export interface SheetRowInput extends SheetRow {
  source: "linkedin" | "web";
  tags?: string[];
  intent?: Intent;
  next_action?: string;
  notes?: string;
}

export interface SavedPost {
  urlId: string;
  url: string;
  post_content: string;
  selection: string | null;
  summary: string | null;
  status: Status;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
  savedAt: number;
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
  USAGE_KV?: KeyValueNamespace;
  FLAGS_KV?: KeyValueNamespace;
  API_VERSION?: string;
  ENVIRONMENT?: "development" | "production";
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  SENTRY_DSN?: string;
}
