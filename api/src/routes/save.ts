import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  DEFAULT_STATUS,
  STATUSES,
  canonicaliseUrl,
  computeUrlHash,
  type ItemInsert,
  type ItemRecord,
  type Intent,
  type Status
} from "@keep-li/shared";

import type { AppEnv } from "../config";
import { fetchSupabaseUser, findItemByHash, insertItem, updateItem, SupabaseError } from "../services/supabase";

const statusSchema = z.enum(["inbox", "to_use", "archived"] as const);
const intentSchema = z.enum(["learn", "post_idea", "outreach", "research"] as const);

const aiResultSchema = z
  .object({
    summary_160: z.string().max(320).optional(),
    tags: z.array(z.string().max(64)).optional(),
    intent: intentSchema.optional(),
    next_action: z.string().max(500).optional()
  })
  .partial();

const requestSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1),
  post_content: z.string().trim().min(1),
  highlight: z.string().max(2000).optional().nullable(),
  status: statusSchema.optional(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string().max(64)).optional(),
  intent: intentSchema.optional().nullable(),
  next_action: z.string().max(500).optional().nullable(),
  aiResult: aiResultSchema.optional().nullable(),
  force: z.boolean().optional(),
  authorName: z.string().optional().nullable(),
  authorHeadline: z.string().optional().nullable(),
  authorCompany: z.string().optional().nullable(),
  authorUrl: z.string().url().optional().nullable(),
  source: z.enum(["linkedin", "web"]).optional(),
  licenseKey: z.string().trim().min(1).optional()
});

type SaveRequest = z.infer<typeof requestSchema>;

type SaveSuccessResponse = {
  ok: true;
  duplicate: boolean;
  item: ReturnType<typeof mapItemRecord>;
};

type SaveErrorResponse = {
  ok: false;
  error: string;
  item?: ReturnType<typeof mapItemRecord>;
};

const sanitize = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const mapItemRecord = (record: ItemRecord) => ({
  id: record.id,
  userId: record.user_id,
  dateAdded: record.date_added,
  source: record.source,
  url: record.url,
  urlHash: record.url_hash,
  title: record.title,
  postContent: record.post_content,
  highlight: record.highlight,
  summary160: record.summary_160,
  tags: record.tags,
  intent: record.intent,
  nextAction: record.next_action,
  notes: record.notes,
  authorName: record.author_name,
  authorHeadline: record.author_headline,
  authorCompany: record.author_company,
  authorUrl: record.author_url,
  status: record.status,
  createdAt: record.created_at,
  updatedAt: record.updated_at
});

const buildItemInsert = async (userId: string, payload: SaveRequest): Promise<ItemInsert> => {
  const canonicalUrl = canonicaliseUrl(payload.url);
  const urlHash = await computeUrlHash(canonicalUrl);
  const source = payload.source ?? (canonicalUrl.includes("linkedin.com") ? "linkedin" : "web");
  const aiResult = payload.aiResult ?? undefined;

  const summary = aiResult?.summary_160 ?? null;
  const tags = payload.tags ?? aiResult?.tags ?? [];
  const intent = payload.intent ?? aiResult?.intent ?? null;
  const nextAction = payload.next_action ?? aiResult?.next_action ?? null;

  return {
    user_id: userId,
    source,
    url: canonicalUrl,
    url_hash: urlHash,
    title: payload.title.trim(),
    post_content: payload.post_content.trim(),
    highlight: sanitize(payload.highlight),
    summary_160: summary,
    tags,
    intent,
    next_action: nextAction,
    notes: sanitize(payload.notes),
    author_name: sanitize(payload.authorName),
    author_headline: sanitize(payload.authorHeadline),
    author_company: sanitize(payload.authorCompany),
    author_url: sanitize(payload.authorUrl),
    status: payload.status ?? DEFAULT_STATUS
  } satisfies ItemInsert;
};

const saveRoute = new Hono<AppEnv>();

saveRoute.post(async (c) => {
  const logger = c.get("logger").child({ route: "save" });
  const config = c.get("config");

  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HTTPException(401, { message: "missing_token" });
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    throw new HTTPException(401, { message: "invalid_token" });
  }

  let body: SaveRequest;
  try {
    const json = await c.req.json();
    body = requestSchema.parse(json);
  } catch (error) {
    logger.warn("save.invalid_request", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HTTPException(400, { message: "invalid_request" });
  }

  let userId: string;
  try {
    const user = await fetchSupabaseUser(config, accessToken);
    userId = user.id;
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 401) {
      throw new HTTPException(401, { message: "unauthorized" });
    }
    logger.error("save.user_lookup_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HTTPException(500, { message: "user_lookup_failed" });
  }

  const itemInsert = await buildItemInsert(userId, body);
  logger.info("save.normalized", {
    userId,
    urlHash: itemInsert.url_hash,
    source: itemInsert.source,
    hasSummary: Boolean(itemInsert.summary_160),
    tagsCount: itemInsert.tags?.length ?? 0,
    force: Boolean(body.force)
  });

  try {
    const existing = await findItemByHash(config, accessToken, userId, itemInsert.url_hash);
    if (existing && !body.force) {
      return c.json(
        {
          ok: false,
          error: "duplicate",
          item: mapItemRecord(existing)
        } satisfies SaveErrorResponse,
        409
      );
    }

    if (existing && body.force) {
      const updated = await updateItem(config, accessToken, existing.id, {
        title: itemInsert.title,
        post_content: itemInsert.post_content,
        highlight: itemInsert.highlight ?? null,
        summary_160: itemInsert.summary_160 ?? null,
        tags: itemInsert.tags ?? [],
        intent: itemInsert.intent ?? null,
        next_action: itemInsert.next_action ?? null,
        notes: itemInsert.notes ?? null,
        author_name: itemInsert.author_name ?? null,
        author_headline: itemInsert.author_headline ?? null,
        author_company: itemInsert.author_company ?? null,
        author_url: itemInsert.author_url ?? null,
        status: (itemInsert.status ?? DEFAULT_STATUS) as Status
      });

      return c.json(
        {
          ok: true,
          duplicate: true,
          item: mapItemRecord(updated)
        } satisfies SaveSuccessResponse,
        200
      );
    }

    const inserted = await insertItem(config, accessToken, itemInsert);
    return c.json(
      {
        ok: true,
        duplicate: false,
        item: mapItemRecord(inserted)
      } satisfies SaveSuccessResponse,
      201
    );
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 401) {
      throw new HTTPException(401, { message: "unauthorized" });
    }

    if (error instanceof SupabaseError && error.status === 409) {
      logger.warn("save.duplicate_on_insert", {
        userId,
        urlHash: itemInsert.url_hash
      });
      return c.json(
        {
          ok: false,
          error: "duplicate"
        } satisfies SaveErrorResponse,
        409
      );
    }

    logger.error("save.unexpected_failure", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HTTPException(500, { message: "save_failed" });
  }
});

export { saveRoute };
