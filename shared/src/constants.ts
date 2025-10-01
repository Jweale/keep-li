import type { FeatureFlags } from "./types";

export const STORAGE_NAMESPACE = "keep-li" as const;

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
  FEATURE_FLAGS: "featureFlags",
} as const;

export type StorageKey = keyof typeof STORAGE_KEYS;

export type StorageKeyOptions = {
  environment?: "development" | "production";
  scope?: string;
};

export function storageKey(key: StorageKey, options: StorageKeyOptions = {}): string {
  const segments: string[] = [STORAGE_NAMESPACE];

  if (options.environment) {
    segments.push(options.environment);
  }

  if (options.scope) {
    segments.push(options.scope);
  }

  segments.push(STORAGE_KEYS[key]);
  return segments.join(":");
}

export function savedPostsStorageKey(options: StorageKeyOptions = {}): string {
  return storageKey("SAVED_POSTS", options);
}

export const API_ORIGINS = {
  development: "http://localhost:8787",
  production: "https://api.keep-li.workers.dev"
} as const;

export const SHEETS_API_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets" as const;

export const DEFAULT_STATUS = "inbox" as const;

export const STATUSES = ["inbox", "to_use", "archived"] as const;

export const API_ENDPOINTS = {
  SUMMARIZE: "/v1/summarize",
  USAGE: "/v1/usage",
  TELEMETRY: "/v1/telemetry",
} as const;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  managedAi: true,
  byoKeyMode: false,
};

export const FEATURE_FLAGS_KV_KEY = "feature-flags" as const;
