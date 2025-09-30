import type { WorkerEnv } from "@keep-li/shared";

export type WorkerRuntimeConfig = {
  environment: "development" | "production";
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
  telemetry: {
    sentryDsn?: string;
  };
};

export type WorkerContext = {
  config: WorkerRuntimeConfig;
};

export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: WorkerContext;
};

export const createWorkerConfig = (env: WorkerEnv): WorkerRuntimeConfig => {
  const environment = env.ENVIRONMENT === "production" ? "production" : "development";

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
    telemetry: {
      sentryDsn: env.SENTRY_DSN
    }
  };
};
