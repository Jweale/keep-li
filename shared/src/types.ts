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

export interface ExtensionTelemetryConfig {
  sentryDsn?: string;
  release?: string;
  tracesSampleRate: number;
}

export interface ExtensionConfig {
  apiEndpoint: string;
  sheetsApiEndpoint: string;
  environment: "development" | "production";
  telemetry: ExtensionTelemetryConfig;
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
}
