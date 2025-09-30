import type { ExtensionConfig } from "@keep-li/shared";

const environment = (import.meta.env.VITE_ENVIRONMENT || "development") as "development" | "production";

export const config: ExtensionConfig = {
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT || "http://localhost:8787",
  sheetsApiEndpoint: import.meta.env.VITE_SHEETS_API_ENDPOINT || "https://sheets.googleapis.com/v4/spreadsheets",
  environment,
};
