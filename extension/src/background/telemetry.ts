import { API_ENDPOINTS, storageKey, type TelemetryBatchRequest, type TelemetryEvent } from "@keep-li/shared";

import { config } from "../config";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const TELEMETRY_ID_KEY = storageKey("TELEMETRY_ID", STORAGE_CONTEXT);

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 10_000;
const RETRY_INTERVAL_MS = 30_000;

let queue: TelemetryEvent[] = [];
let flushTimer: number | null = null;
let pendingFlush: Promise<void> | null = null;
let clientIdPromise: Promise<string> | null = null;

type AiTelemetryStatus = Extract<TelemetryEvent, { type: "ai" }>["status"];
type SaveTelemetryStatus = Extract<TelemetryEvent, { type: "save" }>["aiStatus"];
type InstallReason = Extract<TelemetryEvent, { type: "install" }>["reason"];

type TelemetryEventInput = {
  [Type in TelemetryEvent["type"]]: Omit<Extract<TelemetryEvent, { type: Type }>, "ts"> & { ts?: number };
}[TelemetryEvent["type"]];

const scheduleFlush = (delay: number) => {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay) as unknown as number;
};

const getClientId = async (): Promise<string> => {
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      const stored = await chrome.storage.local.get([TELEMETRY_ID_KEY]);
      const existing = stored[TELEMETRY_ID_KEY];
      if (typeof existing === "string" && existing.trim().length >= 8) {
        return existing;
      }
      const id = crypto.randomUUID();
      await chrome.storage.local.set({ [TELEMETRY_ID_KEY]: id });
      return id;
    })();
  }
  return clientIdPromise;
};

const flush = async () => {
  if (queue.length === 0) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    return;
  }
  if (pendingFlush) {
    return pendingFlush;
  }

  const events = queue.slice();
  queue = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  pendingFlush = (async () => {
    try {
      const clientId = await getClientId();
      const body: TelemetryBatchRequest = {
        clientId,
        environment: config.environment,
        events
      };
      const response = await fetch(`${config.apiEndpoint}${API_ENDPOINTS.TELEMETRY}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        keepalive: true
      });
      if (!response.ok) {
        throw new Error(`telemetry_failed:${response.status}`);
      }
    } catch (error) {
      console.warn("Telemetry flush failed", error);
      queue = events.concat(queue);
      scheduleFlush(RETRY_INTERVAL_MS);
    } finally {
      pendingFlush = null;
    }
  })();

  return pendingFlush;
};

const enqueue = (event: TelemetryEvent) => {
  queue.push(event);
  if (queue.length >= BATCH_SIZE) {
    void flush();
    return;
  }
  scheduleFlush(FLUSH_INTERVAL_MS);
};

export const initTelemetry = async () => {
  try {
    const clientId = await getClientId();
    const uninstallUrl = `${config.apiEndpoint}${API_ENDPOINTS.TELEMETRY}/uninstall?client=${encodeURIComponent(
      clientId
    )}&env=${config.environment}`;
    await chrome.runtime.setUninstallURL(uninstallUrl);
  } catch (error) {
    console.warn("Telemetry init failed", error);
  }

  if (chrome.runtime.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      void flush();
    });
  }
};

export const recordTelemetryEvent = (event: TelemetryEventInput) => {
  const ts = typeof event.ts === "number" ? event.ts : Date.now();
  const fullEvent = { ...event, ts } as TelemetryEvent;
  enqueue(fullEvent);
};

export const recordErrorTelemetry = (code: string, severity: "info" | "warn" | "error") => {
  recordTelemetryEvent({ type: "error", code, severity, origin: "extension" });
};

export const recordAiTelemetry = (status: AiTelemetryStatus, durationMs: number) => {
  recordTelemetryEvent({ type: "ai", status, durationMs });
};

export const recordSaveTelemetry = (aiStatus: SaveTelemetryStatus) => {
  recordTelemetryEvent({ type: "save", aiStatus });
};

export const recordInstallTelemetry = (version: string, reason: InstallReason) => {
  recordTelemetryEvent({ type: "install", version, reason });
};

export const flushTelemetry = async () => {
  await flush();
};
