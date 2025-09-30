export const STORAGE_KEYS = {
  SHEET_ID: "sheetId",
  SAVED_POSTS: "savedPosts",
  LAST_STATUS: "lastStatus",
  AI_ENABLED: "aiEnabled",
  LICENSE_KEY: "licenseKey",
  API_KEY: "apiKey",
  USE_BYO_KEY: "useBYOKey",
  ONBOARDING_COMPLETE: "onboardingComplete",
  TELEMETRY_ENABLED: "telemetryEnabled",
} as const;

export const DEFAULT_STATUS = "inbox" as const;

export const STATUSES = ["inbox", "to_use", "archived"] as const;

export const API_ENDPOINTS = {
  SUMMARIZE: "/v1/summarize",
  USAGE: "/v1/usage",
  TELEMETRY: "/v1/telemetry",
} as const;
