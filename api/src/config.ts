import type { WorkerEnv } from "@keep-li/shared";
import type { Toucan } from "toucan-js";
import type { Logger } from "./utils/logger";

export type WorkerRuntimeConfig = {
  environment: "development" | "staging" | "production";
  api: {
    version: string;
  };
  storage: {
    primary: WorkerEnv["KV"];
    usage: WorkerEnv["KV"];
    flags: WorkerEnv["KV"];
  };
  ai: {
    openaiKey?: string;
    anthropicKey?: string;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
  telemetry: {
    sentryDsn?: string;
    release?: string;
  };
};

export type WorkerContext = {
  config: WorkerRuntimeConfig;
};

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: {
    config: WorkerRuntimeConfig;
    sentry?: Toucan;
    logger: Logger;
  };
};

const resolveEnvironment = (value: WorkerEnv["ENVIRONMENT"]): WorkerRuntimeConfig["environment"] => {
  if (!value) return "development";
  const normalized = value.toLowerCase();
  if (normalized === "production") return "production";
  if (normalized === "staging") return "staging";
  return "development";
};

export const createWorkerConfig = (env: WorkerEnv): WorkerRuntimeConfig => {
  const environment = resolveEnvironment(env.ENVIRONMENT);

  return {
    environment,
    api: {
      version: env.API_VERSION ?? "v1"
    },
    storage: {
      primary: env.KV,
      usage: env.USAGE_KV ?? env.KV,
      flags: env.FLAGS_KV ?? env.KV
    },
    ai: {
      openaiKey: env.OPENAI_API_KEY,
      anthropicKey: env.ANTHROPIC_API_KEY
    },
    supabase: {
      url: resolveSupabaseUrl(env),
      anonKey: resolveSupabaseAnonKey(env),
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
    },
    telemetry: {
      sentryDsn: env.SENTRY_DSN,
      release: env.SENTRY_RELEASE
    }
  };
};

const resolveSupabaseUrl = (env: WorkerEnv): string => {
  const value = env.SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("SUPABASE_URL is required");
  }
  return value.replace(/\/$/, "");
};

const resolveSupabaseAnonKey = (env: WorkerEnv): string => {
  const value = env.SUPABASE_ANON_KEY?.trim();
  if (!value) {
    throw new Error("SUPABASE_ANON_KEY is required");
  }
  return value;
};
