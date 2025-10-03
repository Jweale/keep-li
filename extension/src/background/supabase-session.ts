import { storageKey, type SupabaseSessionTokens } from "@keep-li/shared";

import { config } from "../config";
import { createLogger } from "../telemetry/logger";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SUPABASE_SESSION_KEY = storageKey("SUPABASE_SESSION", STORAGE_CONTEXT);
const ACCESS_TOKEN_BUFFER_SECONDS = 60;
const logger = createLogger({ component: "supabase_session", environment: config.environment });

export type SupabaseSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const readSession = async (): Promise<SupabaseSession | null> => {
  const result = await chrome.storage.local.get(SUPABASE_SESSION_KEY);
  const stored = result[SUPABASE_SESSION_KEY];
  if (!stored || typeof stored !== "object") {
    return null;
  }

  const { accessToken, refreshToken, expiresAt } = stored as Partial<SupabaseSession>;
  if (typeof accessToken !== "string" || typeof expiresAt !== "number") {
    return null;
  }

  return {
    accessToken,
    refreshToken: typeof refreshToken === "string" ? refreshToken : null,
    expiresAt
  } satisfies SupabaseSession;
};

export const getStoredSession = readSession;

export const saveSession = async (session: SupabaseSession): Promise<void> => {
  await chrome.storage.local.set({
    [SUPABASE_SESSION_KEY]: session
  });
};

export const clearSession = async (): Promise<void> => {
  await chrome.storage.local.remove(SUPABASE_SESSION_KEY);
};

const refreshSession = async (refreshToken: string): Promise<SupabaseSession | null> => {
  try {
    const response = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabase.anonKey
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      logger.warn("refresh.failed", { status: response.status });
      return null;
    }

    const data = (await response.json()) as SupabaseSessionTokens;
    const session = tokensToSession(data, refreshToken);
    await saveSession(session);
    return session;
  } catch (error) {
    logger.error("refresh.exception", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

const tokensToSession = (tokens: SupabaseSessionTokens, fallbackRefresh: string | null = null): SupabaseSession => {
  if (!tokens.access_token) {
    throw new Error("access_token_missing");
  }
  const expiresAt = tokens.expires_at
    ? tokens.expires_at
    : nowSeconds() + (tokens.expires_in ?? 3600);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefresh,
    expiresAt
  } satisfies SupabaseSession;
};

export const ensureAccessToken = async (): Promise<SupabaseSession | null> => {
  const session = await readSession();
  if (!session) {
    return null;
  }

  if (session.expiresAt - ACCESS_TOKEN_BUFFER_SECONDS > nowSeconds()) {
    return session;
  }

  if (!session.refreshToken) {
    logger.warn("refresh.unavailable", { reason: "missing_refresh_token" });
    return null;
  }

  return refreshSession(session.refreshToken);
};

const parseAuthCallback = (redirectUrl: string): SupabaseSessionTokens | null => {
  const fragment = redirectUrl.split("#")[1];
  if (!fragment) {
    return null;
  }
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token") ?? undefined;
  const refresh_token = params.get("refresh_token") ?? undefined;
  const expires_in = params.get("expires_in");
  const expires_at = params.get("expires_at");

  if (!access_token) {
    return null;
  }

  const tokens: SupabaseSessionTokens = {
    access_token,
    refresh_token: refresh_token ?? null,
    expires_in: expires_in ? Number(expires_in) : undefined,
    expires_at: expires_at ? Number(expires_at) : undefined
  };

  return tokens;
};

export const launchSupabaseOAuth = async (): Promise<SupabaseSession> => {
  const redirectUrl = chrome.identity.getRedirectURL("supabase");
  const params = new URLSearchParams({
    provider: "google",
    redirect_to: redirectUrl,
    scopes: "email profile",
    response_type: "token"
  });

  const authUrl = `${config.supabase.url}/auth/v1/authorize?${params.toString()}`;

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "auth_failed"));
        return;
      }
      if (!response) {
        reject(new Error("empty_response"));
        return;
      }
      resolve(response);
    });
  });

  const tokens = parseAuthCallback(responseUrl);
  if (!tokens) {
    throw new Error("auth_callback_invalid");
  }

  const session = tokensToSession(tokens);
  await saveSession(session);
  return session;
};

export const setSessionFromTokens = async (tokens: SupabaseSessionTokens): Promise<SupabaseSession> => {
  const session = tokensToSession(tokens);
  await saveSession(session);
  return session;
};
