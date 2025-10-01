import { Hono, type Context } from "hono";
import { z } from "zod";
import { SummarizeOutput } from "@keep-li/shared";
import type { AppEnv } from "../config";
import { createOpenAIProvider } from "../ai/openai";
import { AiProviderError } from "../ai/provider";
import { incrementDailyQuota } from "../services/quota";

const requestSchema = z.object({
  licenseKey: z.string().trim().min(1).optional(),
  post_content: z.string().trim().optional(),
  url: z.string().url(),
  highlight: z.string().max(1000).optional()
});

export const summarizeRoute = new Hono<AppEnv>();

summarizeRoute.post(async (c) => {
  const config = c.get("config");
  // Debug: confirm OpenAI key is present in runtime
  try {
    const keyLen = config.ai.openaiKey ? config.ai.openaiKey.length : 0;
    const keyPrefix = config.ai.openaiKey ? config.ai.openaiKey.slice(0, 12) : "<none>";
    console.log("DEBUG openai key len:", keyLen, "prefix:", keyPrefix);
  } catch (_) {
    // swallow
  }
  if (!config.ai.openaiKey) {
    return c.json({ error: "ai_unavailable" }, 503);
  }

  const parseResult = requestSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    return c.json({ error: "invalid_request", details: parseResult.error.format() }, 400);
  }

  const payload = parseResult.data;
  console.log("DEBUG summarize payload url:", payload.url);
  if (payload.post_content) {
    console.log("DEBUG summarize post_content len:", payload.post_content.length);
  }
  const provider = createOpenAIProvider({ apiKey: config.ai.openaiKey });
  const highlight = payload.highlight?.slice(0, 1000);
  const postContent = payload.post_content ? payload.post_content.slice(0, 2000) : undefined;
  const licenseKey = payload.licenseKey?.trim() || null;
  const quotaLimit = resolveQuotaLimit(config.environment, licenseKey);

  const identifier = licenseKey ? licenseKey : await deriveAnonymousIdentifier(c);
  const quotaResult = await incrementDailyQuota(config.storage.usage, {
    scope: licenseKey ? "license" : "user",
    identifier
  }, quotaLimit);

  if (!quotaResult.allowed) {
    return c.json({ error: "quota_exceeded", quota: quotaResult }, 429);
  }

  try {
    const result = await provider.summarize({
      url: payload.url,
      highlight,
      post_content: postContent
    });

    const response: SummarizeOutput & {
      quota: { limit: number; remaining: number; count: number };
    } = {
      ...result,
      quota: {
        limit: quotaResult.limit,
        remaining: quotaResult.remaining,
        count: quotaResult.count
      }
    };

    return c.json(response, 200);
  } catch (error) {
    if (error instanceof AiProviderError) {
      const status = error.code === "unavailable" ? 503 : 502;
      console.error("DEBUG AiProviderError:", error.message, "code:", error.code);
      return c.json({ error: "ai_provider_error", code: error.code }, status);
    }
    console.error("Summarize failed", error);
    return c.json({ error: "summarize_failed" }, 500);
  }
});

function resolveQuotaLimit(environment: "development" | "production", licenseKey: string | null): number {
  if (licenseKey) {
    return 100;
  }
  return environment === "production" ? 10 : 25;
}

type AppContext = Context<AppEnv>;

async function deriveAnonymousIdentifier(c: AppContext): Promise<string> {
  const ip = c.req.header("CF-Connecting-IP") || "";
  const userAgent = c.req.header("User-Agent") || "";
  const fallback = ip || userAgent || "anonymous";
  const data = new TextEncoder().encode(fallback);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
