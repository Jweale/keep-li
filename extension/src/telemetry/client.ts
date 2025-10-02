import { API_ENDPOINTS, type TelemetryEventPayload } from "@keep-li/shared";
import { config } from "../config";

type JsonValue = string | number | boolean | null;

type FlushState = "idle" | "scheduled" | "running";

const TELEMETRY_URL = config.apiEndpoint ? `${config.apiEndpoint}${API_ENDPOINTS.TELEMETRY}` : null;
const BASE_CONTEXT: Record<string, JsonValue> = (() => {
  const context: Record<string, JsonValue> = {
    environment: config.environment
  };

  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      context.extensionVersion = manifest.version ?? null;
      context.extensionName = manifest.name ?? null;
    }
  } catch {
    context.extensionVersion = null;
  }

  return context;
})();

const PLATFORM = "extension" as const;

class TelemetryClient {
  private readonly maxBatchSize = 20;
  private readonly maxQueueSize = 200;
  private readonly flushIntervalMs = 1500;
  private queue: TelemetryEventPayload[] = [];
  private state: FlushState = "idle";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  enqueue(event: TelemetryEventPayload) {
    if (!TELEMETRY_URL) {
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }

    this.queue.push(event);

    if (event.level === "error") {
      this.scheduleFlush(0);
      return;
    }

    if (this.queue.length >= this.maxBatchSize) {
      this.scheduleFlush(0);
      return;
    }

    this.scheduleFlush(this.flushIntervalMs);
  }

  private scheduleFlush(delay: number) {
    if (this.state === "running") {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.state = "scheduled";
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (!TELEMETRY_URL || this.queue.length === 0 || this.state === "running") {
      this.state = this.queue.length === 0 ? "idle" : this.state;
      return;
    }

    this.state = "running";
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.queue.splice(0, this.maxBatchSize);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(TELEMETRY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          events: batch,
          context: BASE_CONTEXT,
          release: config.telemetry.release,
          platform: PLATFORM
        }),
        keepalive: true,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Telemetry request failed with ${response.status}`);
      }
    } catch {
      this.queue = [...batch, ...this.queue].slice(-this.maxQueueSize);
      this.state = this.queue.length === 0 ? "idle" : "scheduled";
      if (this.state === "scheduled") {
        this.scheduleFlush(this.flushIntervalMs * 2);
      }
      clearTimeout(timeout);
      return;
    }

    clearTimeout(timeout);
    this.state = this.queue.length === 0 ? "idle" : "scheduled";
    if (this.state === "scheduled") {
      this.scheduleFlush(this.flushIntervalMs);
    }
  }
}

export const telemetryClient = new TelemetryClient();
