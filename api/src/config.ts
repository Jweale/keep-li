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
};

export const createWorkerConfig = (env: WorkerEnv): WorkerRuntimeConfig => {
  const environment = env.ENVIRONMENT === "production" ? "production" : "development";

  // Debug: confirm secrets presence (safe prefix only)
  try {
    const openaiLen = env.OPENAI_API_KEY ? env.OPENAI_API_KEY.length : 0;
    const openaiPrefix = env.OPENAI_API_KEY ? env.OPENAI_API_KEY.slice(0, 12) : "<none>";
    console.log("DEBUG config OPENAI key len:", openaiLen, "prefix:", openaiPrefix);
  } catch {}

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
}
