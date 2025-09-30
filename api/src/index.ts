import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import type { WorkerEnv } from "@keep-li/shared";
import { summarizeRoute } from "./routes/summarize";
import { usageRoute } from "./routes/usage";

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use("*", cors({
  origin: ["chrome-extension://*"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", async (c, next) => {
  try {
    await next();
  } catch (error) {
    console.error("Unhandled error", error);
    throw new HTTPException(500, { message: "Internal error" });
  }
});

app.route("/v1/summarize", summarizeRoute);
app.route("/v1/usage", usageRoute);

app.get("/health", (c) => c.json({ status: "ok", version: env(c).API_VERSION ?? "dev" }));

export default app;
