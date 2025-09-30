import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { summarizeRoute } from "./routes/summarize";
import { usageRoute } from "./routes/usage";

const app = new Hono();

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
