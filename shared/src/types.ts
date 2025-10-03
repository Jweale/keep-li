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

export type ItemSource = "linkedin" | "web";

export interface ItemRecord {
  id: string;
  user_id: string;
  date_added: string;
  source: ItemSource;
  url: string;
  url_hash: string;
  title: string;
  post_content: string;
  embed_url: string | null;
  highlight: string | null;
  summary_160: string | null;
  tags: string[];
  intent: Intent | null;
  next_action: string | null;
  notes: string | null;
  author_name: string | null;
  author_headline: string | null;
  author_company: string | null;
  author_url: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
}

export interface ItemInsert {
  user_id: string;
  source: ItemSource;
  url: string;
  url_hash: string;
  title: string;
  post_content: string;
  highlight?: string | null;
  summary_160?: string | null;
  embed_url?: string | null;
  tags?: string[];
  intent?: Intent | null;
  next_action?: string | null;
  notes?: string | null;
  author_name?: string | null;
  author_headline?: string | null;
  author_company?: string | null;
  author_url?: string | null;
  status?: Status;
}

export interface LocalSavedItem {
  id: string;
  url: string;
  urlHash: string;
  title: string;
  postContent: string;
  highlight: string | null;
  summary160: string | null;
  status: Status;
  tags: string[];
  intent: Intent | null;
  nextAction: string | null;
  notes: string | null;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
  embedUrl?: string | null;
  savedAt: number;
}

export interface SaveItemPayload {
  url: string;
  title: string;
  post_content: string;
  highlight?: string | null;
  aiResult?: SummarizeOutput | null;
  status: Status;
  notes?: string | null;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
  tags?: string[];
  intent?: Intent | null;
  next_action?: string | null;
  force?: boolean;
  embedUrl?: string | null;
}

export interface ExtensionTelemetryConfig {
  sentryDsn?: string;
  release?: string;
  tracesSampleRate: number;
}

export interface ExtensionConfig {
  apiEndpoint: string;
  environment: "development" | "production";
  telemetry: ExtensionTelemetryConfig;
  supabase: {
    url: string;
    anonKey: string;
  };
}

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

export interface TelemetryEventPayload {
  source: "extension" | "worker";
  level: TelemetryLevel;
  message: string;
  data?: Record<string, unknown>;
  stack?: string;
  tags?: Record<string, string>;
}

export interface FeatureFlags {
  managedAi: boolean;
  byoKeyMode: boolean;
}

export type TelemetryEvent =
  | {
      type: "install";
      ts: number;
      version: string;
      reason: "install" | "update" | "chrome_update" | "shared_module_update";
    }
  | {
      type: "save";
      ts: number;
      aiStatus: "disabled" | "success" | "timeout" | "quota" | "error";
    }
  | {
      type: "ai";
      ts: number;
      status: "disabled" | "success" | "timeout" | "quota" | "error";
      durationMs: number;
    }
  | {
      type: "error";
      ts: number;
      code: string;
      origin: "extension" | "worker";
      severity: "info" | "warn" | "error";
    }
  | {
      type: "uninstall";
      ts: number;
      reason: "uninstall_url" | "manual";
    };

export interface TelemetryBatchRequest {
  clientId: string;
  environment: "development" | "production";
  events: TelemetryEvent[];
}

export interface TelemetryBatchResponse {
  ok: boolean;
  processed: number;
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
  ENVIRONMENT?: "development" | "staging" | "production";
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface SupabaseSessionTokens {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number;
  expires_at?: number;
}
