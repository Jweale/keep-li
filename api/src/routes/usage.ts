import { Hono } from "hono";
import type { AppEnv } from "../config";

export const usageRoute = new Hono<AppEnv>();

usageRoute.get(async (c) => {
  const licenseKey = c.req.query("licenseKey");
  if (!licenseKey) {
    return c.json({ error: "missing_license_key" }, 400);
  }

  const usageStore = c.get("config").storage.usage;

  const usage = (await usageStore.get(`usage:${licenseKey}`, "json")) as
    | { month: string; count: number }
    | null;

  return c.json({
    licenseKey,
    usage: usage ?? { month: new Date().toISOString().slice(0, 7), count: 0 }
  });
});
