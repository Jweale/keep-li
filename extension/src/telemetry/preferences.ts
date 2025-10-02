import { storageKey } from "@keep-li/shared";
import { config } from "../config";

const TELEMETRY_KEY = storageKey("TELEMETRY_ENABLED", { environment: config.environment });

type Listener = (enabled: boolean) => void;

let enabled = true;
let initialized = false;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of listeners) {
    try {
      listener(enabled);
    } catch {
      // ignore listener failures
    }
  }
};

const readFromStorage = async () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }
  try {
    const stored = await chrome.storage.local.get(TELEMETRY_KEY);
    const value = stored?.[TELEMETRY_KEY];
    if (typeof value === "boolean") {
      enabled = value;
    } else {
      enabled = true;
    }
  } catch {
    enabled = true;
  }
  notify();
};

const ensureInitialized = () => {
  if (initialized) {
    return;
  }
  initialized = true;
  void readFromStorage();
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(TELEMETRY_KEY in changes)) {
        return;
      }
      const value = changes[TELEMETRY_KEY]?.newValue;
      if (typeof value === "boolean") {
        enabled = value;
      } else {
        enabled = true;
      }
      notify();
    });
  }
};

export const isTelemetryEnabled = () => enabled;

export const setTelemetryEnabled = async (value: boolean) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    enabled = value;
    notify();
    return;
  }
  enabled = value;
  notify();
  try {
    await chrome.storage.local.set({ [TELEMETRY_KEY]: value });
  } catch (error) {
    enabled = true;
    notify();
    throw error instanceof Error ? error : new Error(String(error));
  }
};

export const onTelemetryPreferenceChange = (listener: Listener) => {
  listeners.add(listener);
  listener(enabled);
  return () => {
    listeners.delete(listener);
  };
};

ensureInitialized();
