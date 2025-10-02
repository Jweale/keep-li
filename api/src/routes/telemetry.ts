import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../config";
import type { TelemetryBatchRequest, TelemetryEvent } from "@keep-li/shared";

export const telemetryRoute = new Hono<AppEnv>();

const MAX_BATCH_SIZE = 50;

type Snapshot = {
  installs: number;
  installReasons: Record<string, number>;
  uninstalls: number;
  saves: {
    total: number;
    withAi: number;
    withoutAi: number;
    statuses: Record<string, number>;
  };
  ai: {
    counts: Record<string, number>;
    durations: Record<string, { total: number; samples: number }>;
  };
  errors: Record<string, number>;
  updatedAt: number;
};

const createSnapshot = (): Snapshot => ({
  installs: 0,
  installReasons: {},
  uninstalls: 0,
  saves: {
    total: 0,
    withAi: 0,
    withoutAi: 0,
    statuses: {}
  },
  ai: {
    counts: {},
    durations: {}
  },
  errors: {},
  updatedAt: Date.now()
});

const parseEnvironment = (value: string | undefined): "development" | "production" =>
  value === "production" ? "production" : "development";

const normaliseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
};

const isTelemetryEvent = (input: unknown): input is TelemetryEvent => {
  if (!input || typeof input !== "object") {
    return false;
  }
  const type = (input as { type?: unknown }).type;
  const ts = normaliseTimestamp((input as { ts?: unknown }).ts);
  if (ts === null || typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "install":
      return (
        typeof (input as { version?: unknown }).version === "string" &&
        typeof (input as { reason?: unknown }).reason === "string"
      );
    case "save":
      return typeof (input as { aiStatus?: unknown }).aiStatus === "string";
    case "ai":
      return (
        typeof (input as { status?: unknown }).status === "string" &&
        typeof (input as { durationMs?: unknown }).durationMs === "number"
      );
    case "error":
      return (
        typeof (input as { code?: unknown }).code === "string" &&
        typeof (input as { origin?: unknown }).origin === "string" &&
        typeof (input as { severity?: unknown }).severity === "string"
      );
    case "uninstall":
      return typeof (input as { reason?: unknown }).reason === "string";
    default:
      return false;
  }
};

const getStorageKey = (environment: "development" | "production", ts: number) => {
  const day = new Date(ts).toISOString().slice(0, 10);
  return `telemetry:${environment}:${day}`;
};

const applyEvent = (snapshot: Snapshot, event: TelemetryEvent) => {
  snapshot.updatedAt = Date.now();
  switch (event.type) {
    case "install": {
      snapshot.installs += 1;
      snapshot.installReasons[event.reason] = (snapshot.installReasons[event.reason] ?? 0) + 1;
      break;
    }
    case "uninstall": {
      snapshot.uninstalls += 1;
      break;
    }
    case "save": {
      snapshot.saves.total += 1;
      const status = event.aiStatus;
      if (status === "success") {
        snapshot.saves.withAi += 1;
      } else {
        snapshot.saves.withoutAi += 1;
      }
      snapshot.saves.statuses[status] = (snapshot.saves.statuses[status] ?? 0) + 1;
      break;
    }
    case "ai": {
      snapshot.ai.counts[event.status] = (snapshot.ai.counts[event.status] ?? 0) + 1;
      const durations = snapshot.ai.durations[event.status] ?? { total: 0, samples: 0 };
      durations.total += Math.max(0, event.durationMs);
      durations.samples += 1;
      snapshot.ai.durations[event.status] = durations;
      break;
    }
    case "error": {
      const code = `${event.origin}:${event.code}:${event.severity}`;
      snapshot.errors[code] = (snapshot.errors[code] ?? 0) + 1;
      break;
    }
    default:
      break;
  }
};

const persistEvent = async (
  environment: "development" | "production",
  event: TelemetryEvent,
  c: Context<AppEnv>
) => {
  const storage = c.get("config").storage.primary;
  const key = getStorageKey(environment, event.ts);
  const current = (await storage.get(key, "json")) as Snapshot | null;
  const snapshot = current ?? createSnapshot();
  applyEvent(snapshot, event);
  await storage.put(key, JSON.stringify(snapshot));
};

telemetryRoute.post(async (c) => {
  let body: TelemetryBatchRequest;
  try {
    body = (await c.req.json()) as TelemetryBatchRequest;
  } catch (error) {
    console.warn("Telemetry payload parse failed", error);
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!body || typeof body.clientId !== "string" || body.clientId.trim().length < 8) {
    return c.json({ ok: false, error: "invalid_client" }, 400);
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH_SIZE) : [];
  if (events.length === 0) {
    return c.json({ ok: true, processed: 0 } satisfies { ok: boolean; processed: number });
  }

  const environment = parseEnvironment(body.environment);
  let processed = 0;

  for (const event of events) {
    if (!isTelemetryEvent(event)) {
      continue;
    }
    try {
      await persistEvent(environment, event, c);
      processed += 1;
    } catch (error) {
      console.error("Telemetry event persist failed", error);
    }
  }

  return c.json({ ok: true, processed } satisfies { ok: boolean; processed: number });
});

telemetryRoute.get("/uninstall", async (c) => {
  const clientId = c.req.query("client");
  if (!clientId) {
    return c.json({ ok: false, error: "missing_client" }, 400);
  }
  const environment = parseEnvironment(c.req.query("env"));
  const event: TelemetryEvent = {
    type: "uninstall",
    ts: Date.now(),
    reason: "uninstall_url"
  };
  try {
    await persistEvent(environment, event, c);
  } catch (error) {
    console.error("Telemetry uninstall persist failed", error);
  }
  return c.body(null, 204);
});
