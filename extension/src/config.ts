import { API_ORIGINS } from "@keep-li/shared";
import type { ExtensionConfig } from "@keep-li/shared";

const environment = (import.meta.env.VITE_ENVIRONMENT === "production" ? "production" : "development") satisfies
  ExtensionConfig["environment"];

const tracesSampleRateEnv = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE;
const tracesSampleRate = (() => {
  if (typeof tracesSampleRateEnv === "string" && tracesSampleRateEnv.trim().length > 0) {
    const parsed = Number(tracesSampleRateEnv);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return environment === "production" ? 0.1 : 1;
})();

const overrides = {
  development: {
    apiEndpoint: import.meta.env.VITE_API_ENDPOINT_DEV as string | undefined,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL_DEV as string | undefined,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_DEV as string | undefined
  },
  production: {
    apiEndpoint: import.meta.env.VITE_API_ENDPOINT_PROD as string | undefined,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL_PROD as string | undefined,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_PROD as string | undefined
  }
} satisfies Record<ExtensionConfig["environment"], { apiEndpoint?: string; supabaseUrl?: string; supabaseAnonKey?: string }>;

const resolveSupabaseConfig = (envKey: ExtensionConfig["environment"]): ExtensionConfig["supabase"] => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? overrides[envKey].supabaseUrl;
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? overrides[envKey].supabaseAnonKey;

  if (!url || !anonKey) {
    throw new Error("Supabase configuration missing");
  }

  return {
    url: url.replace(/\/$/, ""),
    anonKey
  };
};

export const config: ExtensionConfig = {
  apiEndpoint:
    import.meta.env.VITE_API_ENDPOINT || overrides[environment].apiEndpoint || API_ORIGINS[environment],
  environment,
  telemetry: {
    sentryDsn: import.meta.env.VITE_SENTRY_DSN || undefined,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate
  },
  supabase: resolveSupabaseConfig(environment)
};
