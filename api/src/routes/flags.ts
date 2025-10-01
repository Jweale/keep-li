import { Hono } from "hono";
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAGS_KV_KEY, type FeatureFlags } from "@keep-li/shared";

import type { AppEnv } from "../config";

const flagsRoute = new Hono<AppEnv>();

const isFeatureFlags = (value: unknown): value is FeatureFlags => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.managedAi === "boolean" && typeof candidate.byoKeyMode === "boolean";
};

flagsRoute.get(async (c) => {
  const store = c.get("config").storage.flags;

  let flags = DEFAULT_FEATURE_FLAGS;

  try {
    const stored = (await store.get(FEATURE_FLAGS_KV_KEY, "json")) as FeatureFlags | Record<string, unknown> | null;
    if (isFeatureFlags(stored)) {
      flags = stored;
    } else if (stored && typeof stored === "object") {
      const candidate = stored as Record<string, unknown>;
      flags = {
        managedAi:
          typeof candidate.managedAi === "boolean" ? candidate.managedAi : DEFAULT_FEATURE_FLAGS.managedAi,
        byoKeyMode:
          typeof candidate.byoKeyMode === "boolean" ? candidate.byoKeyMode : DEFAULT_FEATURE_FLAGS.byoKeyMode,
      } satisfies FeatureFlags;
    }
  } catch (error) {
    console.warn("Failed to load feature flags, using defaults", error);
  }

  return c.json({ flags, environment: c.get("config").environment });
});

export { flagsRoute };
