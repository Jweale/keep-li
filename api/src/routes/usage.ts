import { Hono } from "hono";

type Bindings = {
  USAGE_KV: KVNamespace;
};

export const usageRoute = new Hono<{ Bindings: Bindings }>();

usageRoute.get(async (c) => {
  const licenseKey = c.req.query("licenseKey");
  if (!licenseKey) {
    return c.json({ error: "missing_license_key" }, 400);
  }

  const usage = (await c.env.USAGE_KV.get(`usage:${licenseKey}`, "json")) as
    | { month: string; count: number }
    | null;

  return c.json({
    licenseKey,
    usage: usage ?? { month: new Date().toISOString().slice(0, 7), count: 0 }
  });
});
