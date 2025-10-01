import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { summarizeRoute } from "./routes/summarize";
import { usageRoute } from "./routes/usage";
import { flagsRoute } from "./routes/flags";
import { createWorkerConfig, type AppEnv } from "./config";

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
  c.set("config", createWorkerConfig(env(c)));
  try {
    await next();
  } catch (error) {
    console.error("Unhandled error", error);
    throw new HTTPException(500, { message: "Internal error" });
  }
});

app.route("/v1/summarize", summarizeRoute);
app.route("/v1/usage", usageRoute);
app.route("/v1/flags", flagsRoute);

app.get("/health", (c) => c.json({ status: "ok", version: env(c).API_VERSION ?? "dev" }));

export default app;
