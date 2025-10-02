import { Hono } from "hono";
import { z } from "zod";
import { sanitize } from "../utils/logger";
import type { AppEnv } from "../config";

const telemetryRoute = new Hono<AppEnv>();

const telemetryLevel = z.enum(["debug", "info", "warn", "error"]);
const telemetrySource = z.enum(["extension", "worker"]);

const telemetryEventSchema = z.object({
  source: telemetrySource,
  level: telemetryLevel,
  message: z.string().min(1).max(512),
  data: z.record(z.string(), z.unknown()).optional(),
  stack: z.string().max(4000).optional(),
  tags: z.record(z.string(), z.string()).optional()
});

const requestSchema = z.object({
  events: z.array(telemetryEventSchema).min(1).max(50),
  context: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  release: z.string().max(64).optional(),
  platform: z.string().max(64).optional()
});

type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

type TelemetryMetricsRecord = {
  date: string;
  counts: Record<string, number>;
  sources: Record<string, Record<string, number>>;
};

const METRICS_KEY_PREFIX = "telemetry:counts:" as const;
const METRICS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METRICS_TTL_SECONDS = 90 * 24 * 60 * 60;

const getMetricsKey = (date: string) => `${METRICS_KEY_PREFIX}${date}`;

telemetryRoute.post(async (c) => {
  const logger = c.get("logger").child({ route: "telemetry" });
  const sentry = c.get("sentry");
  const store = c.get("config").storage.primary;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    logger.warn("telemetry.invalid_json", {
      message: error instanceof Error ? error.message : String(error)
    });
    return c.json({ error: "invalid_json" }, 400);
  }

  const parseResult = requestSchema.safeParse(body);
  if (!parseResult.success) {
    logger.warn("telemetry.invalid_payload", {
      issues: parseResult.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return c.json({ error: "invalid_payload" }, 400);
  }

  const { events, context, release, platform } = parseResult.data;
  const metricsDate = new Date().toISOString().slice(0, 10);
  const metricsBuffer: TelemetryEvent[] = [];

  for (const event of events) {
    const eventLogger = logger.child({ source: event.source });
    const metadata = {
      message: event.message,
      tags: event.tags ?? {},
      context: context ?? {},
      data: event.data ? sanitize(event.data) : undefined,
      stack: event.stack,
      release: release ?? null,
      platform: platform ?? null
    };

    const logFn =
      event.level === "debug"
        ? eventLogger.debug.bind(eventLogger)
        : event.level === "info"
          ? eventLogger.info.bind(eventLogger)
          : event.level === "warn"
            ? eventLogger.warn.bind(eventLogger)
            : eventLogger.error.bind(eventLogger);

    logFn("telemetry.event", metadata);

    if (sentry && (event.level === "warn" || event.level === "error")) {
      sentry.withScope((scope) => {
        scope.setTag("telemetry_source", event.source);
        if (release) {
          scope.setTag("telemetry_release", release);
        }
        if (platform) {
          scope.setTag("telemetry_platform", platform);
        }
        for (const [key, value] of Object.entries(event.tags ?? {})) {
          scope.setTag(`telemetry_${key}`, value);
        }
        if (context) {
          scope.setContext("telemetry_context", context);
        }
        if (event.data) {
          scope.setExtra("telemetry_data", sanitize(event.data));
        }
        if (event.stack) {
          scope.setExtra("stack", event.stack);
        }
        sentry.captureMessage(event.message, event.level === "error" ? "error" : "warning");
      });
    }

    metricsBuffer.push(event);
  }

  await updateMetrics(store, metricsDate, metricsBuffer, logger.child({ sink: "metrics" }));
  logger.info("telemetry.batch_accepted", { count: events.length });
  return c.json({ accepted: events.length }, 202);
});

telemetryRoute.get(async (c) => {
  const logger = c.get("logger").child({ route: "telemetry" });
  const store = c.get("config").storage.primary;
  const requested = c.req.query("date");
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = typeof requested === "string" && METRICS_DATE_RE.test(requested) ? requested : today;
  const key = getMetricsKey(targetDate);
  const record = (await store.get(key, "json")) as TelemetryMetricsRecord | null;
  logger.debug("telemetry.metrics_requested", { date: targetDate, found: Boolean(record) });
  const fallback: TelemetryMetricsRecord = {
    date: targetDate,
    counts: {},
    sources: {}
  };
  return c.json(record ?? fallback, 200);
});

const updateMetrics = async (
  store: AppEnv["Bindings"]["KV"],
  date: string,
  events: TelemetryEvent[],
  logger: AppEnv["Variables"]["logger"]
) => {
  if (events.length === 0) {
    return;
  }

  const key = getMetricsKey(date);
  let record = (await store.get(key, "json")) as TelemetryMetricsRecord | null;
  if (!record || record.date !== date) {
    record = { date, counts: {}, sources: {} } satisfies TelemetryMetricsRecord;
  }

  for (const event of events) {
    record.counts[event.level] = (record.counts[event.level] ?? 0) + 1;
    const sourceBucket = record.sources[event.source] ?? {};
    sourceBucket[event.level] = (sourceBucket[event.level] ?? 0) + 1;
    record.sources[event.source] = sourceBucket;
  }

  try {
    await store.put(key, JSON.stringify(record), { expirationTtl: METRICS_TTL_SECONDS });
  } catch (error) {
    logger.error("telemetry.metrics_persist_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export { telemetryRoute };
