import { Hono, type Context } from "hono";
import { z } from "zod";
import { SummarizeOutput } from "@keep-li/shared";
import type { AppEnv, WorkerRuntimeConfig } from "../config";
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
  const sentry = c.get("sentry");
  const logger = c.get("logger").child({ route: "summarize" });

  logger.debug("summarize.request_received");

  if (!config.ai.openaiKey) {
    logger.error("summarize.openai_key_missing");
    return c.json({ error: "ai_unavailable" }, 503);
  }

  const parseResult = requestSchema.safeParse(await c.req.json());
  if (!parseResult.success) {
    logger.warn("summarize.invalid_request", {
      issues: parseResult.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return c.json({ error: "invalid_request", details: parseResult.error.format() }, 400);
  }

  const payload = parseResult.data;
  logger.debug("summarize.payload_normalized", {
    url: payload.url,
    hasPostContent: Boolean(payload.post_content),
    postContentLength: payload.post_content?.length ?? 0,
    hasHighlight: Boolean(payload.highlight)
  });

  const provider = createOpenAIProvider({ apiKey: config.ai.openaiKey, logger: logger.child({ component: "openai" }) });
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
    logger.warn("summarize.quota_exceeded", {
      scope: licenseKey ? "license" : "user",
      limit: quotaResult.limit,
      licenseKeyPresent: Boolean(licenseKey)
    });
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

    logger.info("summarize.completed", {
      tokensIn: response.tokens_in,
      tokensOut: response.tokens_out,
      quotaRemaining: quotaResult.remaining,
      licenseKeyPresent: Boolean(licenseKey)
    });

    return c.json(response, 200);
  } catch (error) {
    if (error instanceof AiProviderError) {
      const status = error.code === "unavailable" ? 503 : 502;
      logger.error("summarize.provider_failed", {
        code: error.code,
        message: error.message,
        url: payload.url
      });
      sentry?.withScope((scope) => {
        scope.setTag("component", "summarizeRoute");
        scope.setContext("ai", { code: error.code, url: payload.url });
        sentry.captureException(error);
      });
      return c.json({ error: "ai_provider_error", code: error.code }, status);
    }
    logger.error("summarize.unexpected_failure", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    sentry?.captureException(error);
    return c.json({ error: "summarize_failed" }, 500);
  }
});

function resolveQuotaLimit(environment: WorkerRuntimeConfig["environment"], licenseKey: string | null): number {
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
