import { Hono } from "hono";
import { z } from "zod";
import { SummarizeInput, SummarizeOutput } from "@keep-li/shared";
import type { AppEnv } from "../config";

const requestSchema = z.object({
  licenseKey: z.string().trim().min(1).optional(),
  title: z.string().trim().optional(),
  url: z.string().url(),
  highlight: z.string().max(1000).optional()
});

export const summarizeRoute = new Hono<AppEnv>();

summarizeRoute.post(async (c) => {
  const parseResult = requestSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    return c.json({ error: "invalid_request", details: parseResult.error.format() }, 400);
  }

  const payload: SummarizeInput = parseResult.data;
  const summarySource = payload.highlight ?? payload.title ?? payload.url;
  const summary = summarySource.slice(0, 160);

  const response: SummarizeOutput = {
    summary_160: summary,
    tags: [],
    intent: "learn",
    next_action: "",
    tokens_in: 0,
    tokens_out: 0
  };

  return c.json(response, 200);
});
