import { API_ORIGINS, SHEETS_API_ENDPOINT } from "@keep-li/shared";
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
    sheetsApiEndpoint: import.meta.env.VITE_SHEETS_API_ENDPOINT_DEV as string | undefined
  },
  production: {
    apiEndpoint: import.meta.env.VITE_API_ENDPOINT_PROD as string | undefined,
    sheetsApiEndpoint: import.meta.env.VITE_SHEETS_API_ENDPOINT_PROD as string | undefined
  }
} satisfies Record<ExtensionConfig["environment"], { apiEndpoint?: string; sheetsApiEndpoint?: string }>;

export const config: ExtensionConfig = {
  apiEndpoint:
    import.meta.env.VITE_API_ENDPOINT || overrides[environment].apiEndpoint || API_ORIGINS[environment],
  sheetsApiEndpoint:
    import.meta.env.VITE_SHEETS_API_ENDPOINT || overrides[environment].sheetsApiEndpoint || SHEETS_API_ENDPOINT,
  environment,
  telemetry: {
    sentryDsn: import.meta.env.VITE_SENTRY_DSN || undefined,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate
  }
};
