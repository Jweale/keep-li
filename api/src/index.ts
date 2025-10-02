import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { Toucan } from "toucan-js";
import { createLogger } from "./utils/logger";
import { summarizeRoute } from "./routes/summarize";
import { usageRoute } from "./routes/usage";
import { flagsRoute } from "./routes/flags";
import { telemetryRoute } from "./routes/telemetry";
import { createWorkerConfig, type AppEnv, type WorkerRuntimeConfig } from "./config";

const app = new Hono<AppEnv>();

app.use("*", cors({
  origin(origin: string | undefined) {
    if (!origin) {
      return "*";
    }
    if (origin.startsWith("chrome-extension://")) {
      return origin;
    }
    if (origin.startsWith("http://localhost") || origin.startsWith("https://localhost")) {
      return origin;
    }
    return "";
  },
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", async (c, next) => {
  const workerEnv = env(c);
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const baseLogger = createLogger({
    requestId,
    path: c.req.path,
    method: c.req.method
  });

  c.set("logger", baseLogger);

  let config: WorkerRuntimeConfig;
  try {
    config = createWorkerConfig(workerEnv);
  } catch (error) {
    baseLogger.error("config.load_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  const logger = baseLogger.child({
    environment: config.environment
  });

  c.set("config", config);
  c.set("logger", logger);

  const sentry = config.telemetry.sentryDsn
    ? new Toucan({
        dsn: config.telemetry.sentryDsn,
        context: c.executionCtx,
        request: c.req.raw,
        environment: config.environment,
        release: config.telemetry.release
      })
    : null;

  if (sentry) {
    sentry.setTag("runtime", "worker");
    sentry.setTag("cf-ray", requestId);
  }

  c.set("sentry", sentry ?? undefined);
  c.set("logger", logger);

  logger.info("request.received", {
    userAgent: c.req.header("user-agent") ?? null
  });

  try {
    await next();
    logger.info("request.completed", { status: c.res.status });
  } catch (error) {
    logger.error("request.failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
});

app.route("/v1/summarize", summarizeRoute);
app.route("/v1/usage", usageRoute);
app.route("/v1/flags", flagsRoute);
app.route("/v1/telemetry", telemetryRoute);

app.get("/health", (c) => c.json({ status: "ok", version: env(c).API_VERSION ?? "dev" }));

app.onError((error, c) => {
  const sentry = c.get("sentry");
  const logger = c.get("logger");
  if (sentry && (!(error instanceof HTTPException) || error.status >= 500)) {
    sentry.captureException(error);
  }

  if (error instanceof HTTPException) {
    logger?.warn("request.handled_error", {
      status: error.status,
      message: error.message
    });
    return error.getResponse();
  }
  logger?.error("request.unhandled_error", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  return c.json({ message: "Internal error" }, 500);
});

export default app;
