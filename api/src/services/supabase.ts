import type { ItemInsert, ItemRecord } from "@keep-li/shared";
import type { WorkerRuntimeConfig } from "../config";

export class SupabaseError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
  }
}

type SupabaseUser = {
  id: string;
  email?: string;
};

const buildBaseHeaders = (config: WorkerRuntimeConfig, accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  apikey: config.supabase.anonKey
});

const supabaseUrl = (config: WorkerRuntimeConfig, path: string) => {
  const cleaned = path.startsWith("/") ? path.slice(1) : path;
  return `${config.supabase.url}/${cleaned}`;
};

export const fetchSupabaseUser = async (
  config: WorkerRuntimeConfig,
  accessToken: string
): Promise<SupabaseUser> => {
  const response = await fetch(supabaseUrl(config, "auth/v1/user"), {
    headers: buildBaseHeaders(config, accessToken)
  });

  if (response.status === 401) {
    throw new SupabaseError("unauthorized", 401);
  }

  if (!response.ok) {
    throw new SupabaseError(`failed_to_fetch_user:${response.status}`, response.status);
  }

  const body = (await response.json()) as Partial<SupabaseUser>;
  if (!body.id || typeof body.id !== "string") {
    throw new SupabaseError("invalid_user_response", 500);
  }

  return {
    id: body.id,
    email: typeof body.email === "string" ? body.email : undefined
  };
};

export const findItemByHash = async (
  config: WorkerRuntimeConfig,
  accessToken: string,
  userId: string,
  urlHash: string
): Promise<ItemRecord | null> => {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`,
    url_hash: `eq.${urlHash}`,
    select: "*",
    limit: "1"
  });

  const response = await fetch(supabaseUrl(config, `rest/v1/items?${params.toString()}`), {
    headers: {
      ...buildBaseHeaders(config, accessToken),
      "Accept-Profile": "public"
    }
  });

  if (response.status === 401) {
    throw new SupabaseError("unauthorized", 401);
  }

  if (!response.ok) {
    throw new SupabaseError(`failed_to_fetch_items:${response.status}`, response.status);
  }

  const data = (await response.json()) as ItemRecord[];
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  return data[0];
};

export const insertItem = async (
  config: WorkerRuntimeConfig,
  accessToken: string,
  payload: ItemInsert
): Promise<ItemRecord> => {
  const response = await fetch(supabaseUrl(config, "rest/v1/items"), {
    method: "POST",
    headers: {
      ...buildBaseHeaders(config, accessToken),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "Accept-Profile": "public"
    },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    throw new SupabaseError("unauthorized", 401);
  }

  if (response.status === 409) {
    throw new SupabaseError("duplicate", 409);
  }

  if (!response.ok) {
    throw new SupabaseError(`failed_to_insert_item:${response.status}`, response.status);
  }

  const data = (await response.json()) as ItemRecord[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new SupabaseError("empty_insert_response", 500);
  }

  return data[0];
};

export const updateItem = async (
  config: WorkerRuntimeConfig,
  accessToken: string,
  itemId: string,
  payload: Partial<Omit<ItemInsert, "user_id">>
): Promise<ItemRecord> => {
  const params = new URLSearchParams({
    id: `eq.${itemId}`
  });

  const response = await fetch(supabaseUrl(config, `rest/v1/items?${params.toString()}`), {
    method: "PATCH",
    headers: {
      ...buildBaseHeaders(config, accessToken),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "Accept-Profile": "public"
    },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    throw new SupabaseError("unauthorized", 401);
  }

  if (!response.ok) {
    throw new SupabaseError(`failed_to_update_item:${response.status}`, response.status);
  }

  const data = (await response.json()) as ItemRecord[];
  if (!Array.isArray(data) || data.length === 0) {
    throw new SupabaseError("empty_update_response", 500);
  }

  return data[0];
};
