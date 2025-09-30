import { API_ORIGINS, SHEETS_API_ENDPOINT } from "@keep-li/shared";
import type { ExtensionConfig } from "@keep-li/shared";

const environment = (import.meta.env.VITE_ENVIRONMENT === "production" ? "production" : "development") satisfies
  ExtensionConfig["environment"];

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
  environment
};
