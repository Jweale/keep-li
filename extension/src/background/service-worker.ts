import {
  API_ENDPOINTS,
  canonicaliseUrl,
  computeUrlHash,
  savedPostsStorageKey,
  storageKey,
  type SavedPost,
  type SheetRowInput,
  type Status,
  type SummarizeOutput
} from "@keep-li/shared";

import { config } from "../config";
import { initBrowserSentry } from "../telemetry/init-browser";
import { createLogger } from "../telemetry/logger";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SAVED_POSTS_KEY = savedPostsStorageKey(STORAGE_CONTEXT);
const SHEET_ID_KEY = storageKey("SHEET_ID", STORAGE_CONTEXT);
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const SHEET_RANGE = "Saves!A1:P1";
const SAVED_POSTS_LIMIT = 50;
const SAVED_POST_RETENTION_DAYS = 90;
const notificationLinks = new Map<string, string>();
const captureMetadataByTab = new Map<number, PendingCapture>();
let lastActivatedTabId: number | null = null;
const sentry = initBrowserSentry({ context: "background" });
const logger = createLogger({ component: "background_service_worker", environment: config.environment });
const aiLogger = logger.child({ feature: "managed_ai" });

const toErrorMetadata = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined
});

const captureException = (error: unknown, component?: string) => {
  if (!sentry) {
    return;
  }
  sentry.withScope((scope) => {
    if (component) {
      scope.setTag("component", component);
    }
    scope.captureException(error instanceof Error ? error : new Error(String(error)));
  });
};

type PendingCapture = {
  url?: string;
  post_content?: string;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
};

type SidePanelApi = {
  setPanelBehavior?(options: { openPanelOnActionClick: boolean }): Promise<void> | void;
  setOptions?(options: { tabId: number; path: string; enabled?: boolean }): Promise<void> | void;
  open?(options: { tabId: number }): Promise<void> | void;
};

const sidePanel = (chrome as typeof chrome & { sidePanel?: SidePanelApi }).sidePanel;

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const target = notificationLinks.get(notificationId);
    if (!target) {
      return;
    }
    chrome.tabs.create({ url: target }).catch((error) => {
      logger.warn("notifications.open_sheet_failed", {
        notificationId,
        target,
        error: toErrorMetadata(error)
      });
      captureException(error, "notifications");
    });
    chrome.notifications.clear(notificationId, () => {
      chrome.runtime.lastError;
    });
    notificationLinks.delete(notificationId);
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (sidePanel?.setPanelBehavior) {
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  logger.info("lifecycle.installed", { reason: details.reason });

  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chromeStorageSet(ONBOARDING_COMPLETE_KEY, false).catch((error) => {
      logger.warn("onboarding.initialize_failed", {
        error: toErrorMetadata(error)
      });
      captureException(error, "onInstalled");
    });

    const onboardingUrl = chrome.runtime.getURL("src/onboarding/index.html");
    chrome.tabs
      .create({ url: onboardingUrl })
      .catch((error) => {
        logger.warn("onboarding.tab_open_failed", {
          error: toErrorMetadata(error)
        });
        captureException(error, "onInstalled");
      });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_popup") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openCaptureUi(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "save-to-sheet": {
      const payload = message.payload as SaveMessagePayload;

      void handleSaveToSheet(payload)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error) => {
          logger.error("save.failed", {
            error: toErrorMetadata(error)
          });
          captureException(error, "handleSaveToSheet");
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return true;
    }
    case "open-capture-panel": {
      if (!sender.tab?.id) {
        sendResponse({ ok: false });
        return false;
      }
      captureMetadataByTab.set(sender.tab.id, message.payload as PendingCapture);
      try {
        void chrome.runtime
          .sendMessage({ type: "capture-metadata-updated", tabId: sender.tab.id })
          .catch((error) => {
            if (error) {
              logger.warn("capture.metadata_notification_failed", {
                error: toErrorMetadata(error),
                tabId: sender.tab?.id ?? null
              });
            }
          });
      } catch (error) {
        logger.warn("capture.metadata_dispatch_failed", {
          error: toErrorMetadata(error),
          tabId: sender.tab?.id ?? null
        });
      }
      void openCaptureUi(sender.tab)
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          logger.error("capture.open_ui_failed", {
            error: toErrorMetadata(error),
            tabId: sender.tab?.id ?? null
          });
          captureException(error, "openCaptureUi");
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }
    case "consume-capture-metadata": {
      const tabId = (message.tabId ?? lastActivatedTabId) as number | undefined;
      if (!tabId) {
        sendResponse({ metadata: null });
        return false;
      }
      const metadata = captureMetadataByTab.get(tabId) ?? null;
      if (metadata) {
        captureMetadataByTab.delete(tabId);
      }
      lastActivatedTabId = tabId;
      sendResponse({ metadata });
      return false;
    }
    default:
      return false;
  }
});

type SaveMessagePayload = {
  url?: string;
  post_content?: string;
  highlight?: string;
  status: Status;
  notes?: string;
  aiEnabled?: boolean;
  aiResult?: SummarizeOutput | null;
  force?: boolean;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
};

type ManagedAiStatus = "disabled" | "success" | "timeout" | "quota" | "error";

type ManagedAiOutcome = {
  status: ManagedAiStatus;
  result: SummarizeOutput | null;
  quota?: ManagedAiQuota | null;
  error?: string;
};

type ManagedAiQuota = {
  limit: number;
  remaining: number;
  count: number;
};

type SaveNotice = {
  level: "info" | "warning";
  message: string;
};

type SaveResponse =
  | {
      ok: true;
      row: SheetRowInput;
      ai: ManagedAiOutcome;
      notices: SaveNotice[];
    }
  | { ok: false; error: string; duplicate?: SavedPost };

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function openCaptureUi(tab?: chrome.tabs.Tab | null) {
  let targetTab = tab;
  if (!targetTab) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = activeTab ?? null;
  }

  if (targetTab?.id) {
    lastActivatedTabId = targetTab.id;
  }

  if (sidePanel?.open && targetTab?.id) {
    try {
      if (sidePanel.setOptions) {
        void sidePanel
          .setOptions({
            tabId: targetTab.id,
            path: "src/panel/index.html",
            enabled: true
          })
          .catch((error) => {
            logger.warn("sidepanel.set_options_failed", {
              error: toErrorMetadata(error),
              tabId: targetTab?.id ?? null
            });
          });
      }

      const result = sidePanel.open({ tabId: targetTab.id });
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
      return;
    } catch (error) {
      logger.warn("sidepanel.open_failed_fallback", {
        error: toErrorMetadata(error),
        tabId: targetTab?.id ?? null
      });
      captureException(error, "openCaptureUi");
    }
  }

  chrome.action.openPopup();
}

async function handleSaveToSheet(payload: SaveMessagePayload): Promise<SaveResponse> {
  if (!payload.url || !payload.post_content) {
    return { ok: false, error: "missing_fields" };
  }

  const sheetId = await getSheetId();
  if (!sheetId) {
    return { ok: false, error: "missing_sheet_id" };
  }

  const canonicalUrl = canonicaliseUrl(payload.url);
  const urlId = await computeUrlHash(canonicalUrl);

  if (!payload.force) {
    const duplicate = await findDuplicate(urlId);
    if (duplicate) {
      return { ok: false, error: "duplicate", duplicate };
    }
  }

  const aiEnabled = payload.aiEnabled !== false;
  const highlight = payload.highlight?.slice(0, 1000);
  let aiOutcome: ManagedAiOutcome = {
    status: "disabled",
    result: payload.aiResult ?? null,
    quota: null
  };

  if (aiEnabled && !payload.aiResult) {
    aiOutcome = await summarizeWithManagedAi({
      url: canonicalUrl,
      post_content: payload.post_content,
      highlight
    });
  } else if (payload.aiResult) {
    aiOutcome = {
      status: "success",
      result: payload.aiResult,
      quota: null
    };
  }

  const row = await prepareSheetRow({
    url: canonicalUrl,
    post_content: payload.post_content,
    highlight,
    status: payload.status,
    notes: payload.notes,
    aiResult: aiOutcome.result,
    authorName: payload.authorName ?? null,
    authorHeadline: payload.authorHeadline ?? null,
    authorCompany: payload.authorCompany ?? null,
    authorUrl: payload.authorUrl ?? null
  });

  await appendRowToSheet(sheetId, row);
  await storeSavedPost(row);
  await showSaveNotification(row, sheetId).catch((error) => {
    logger.warn("notification.show_failed", {
      error: toErrorMetadata(error),
      sheetId,
      urlId: row.urlId
    });
  });

  const notices = buildNoticesForAiOutcome(aiOutcome);

  logger.info("save.row_appended", { sheetId, urlId: row.urlId });
  return {
    ok: true,
    row,
    ai: aiOutcome,
    notices
  };
}

export async function prepareSheetRow(input: {
  url: string;
  post_content: string;
  highlight?: string;
  status: Status;
  notes?: string;
  aiResult: SummarizeOutput | null;
  authorName?: string | null;
  authorHeadline?: string | null;
  authorCompany?: string | null;
  authorUrl?: string | null;
}): Promise<SheetRowInput> {
  const canonicalUrl = canonicaliseUrl(input.url);
  const urlHash = await computeUrlHash(canonicalUrl);
  const ai = input.aiResult ?? null;
  const highlight = input.highlight?.trim();

  return {
    timestamp: new Date().toISOString(),
    source: canonicalUrl.includes("linkedin.com") ? "linkedin" : "web",
    url: canonicalUrl,
    urlId: urlHash,
    post_content: input.post_content,
    authorName: input.authorName ?? null,
    authorHeadline: input.authorHeadline ?? null,
    authorCompany: input.authorCompany ?? null,
    authorUrl: input.authorUrl ?? null,
    selection: highlight ? highlight : null,
    status: input.status,
    summary: ai?.summary_160 ?? null,
    tags: ai?.tags,
    intent: ai?.intent,
    next_action: ai?.next_action,
    notes: input.notes
  } satisfies SheetRowInput;
}

type ManagedAiArgs = {
  url: string;
  post_content: string;
  highlight?: string | null;
};

type ManagedAiResponse = SummarizeOutput & {
  quota?: ManagedAiQuota;
};

async function summarizeWithManagedAi(args: ManagedAiArgs): Promise<ManagedAiOutcome> {
  const endpoint = `${config.apiEndpoint}${API_ENDPOINTS.SUMMARIZE}`;
  const licenseKey = await getLicenseKey();
  const payload = {
    url: args.url,
    post_content: args.post_content.slice(0, 2000),
    highlight: args.highlight,
    licenseKey
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }

      if (response.status === 429 && isQuotaResponse(body)) {
        const outcome: ManagedAiOutcome = {
          status: "quota",
          result: null,
          quota: body.quota,
          error: "quota_exceeded"
        };
        logAiTelemetry({ status: outcome.status, durationMs: Date.now() - startedAt, quota: body.quota });
        return outcome;
      }

      const outcome: ManagedAiOutcome = {
        status: "error",
        result: null,
        quota: null,
        error: typeof body === "string" ? body : JSON.stringify(body)
      };
      logAiTelemetry({ status: outcome.status, durationMs: Date.now() - startedAt, error: outcome.error });
      return outcome;
    }

    const data = (await response.json()) as ManagedAiResponse;
    if (typeof data.summary_160 !== "string") {
      const outcome: ManagedAiOutcome = {
        status: "error",
        result: null,
        quota: data.quota,
        error: "invalid_response"
      };
      logAiTelemetry({ status: outcome.status, durationMs: Date.now() - startedAt, error: outcome.error });
      return outcome;
    }

    const result: SummarizeOutput = {
      summary_160: data.summary_160,
      tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : [],
      intent: data.intent ?? "learn",
      next_action: typeof data.next_action === "string" ? data.next_action : "",
      tokens_in: typeof data.tokens_in === "number" ? data.tokens_in : 0,
      tokens_out: typeof data.tokens_out === "number" ? data.tokens_out : 0
    } satisfies SummarizeOutput;

    const outcome: ManagedAiOutcome = {
      status: "success",
      result,
      quota: data.quota ?? null
    };
    logAiTelemetry({ status: outcome.status, durationMs: Date.now() - startedAt, quota: data.quota });
    return outcome;
  } catch (error) {
    const outcome: ManagedAiOutcome = {
      status: error instanceof DOMException || (error as { name?: string }).name === "AbortError" ? "timeout" : "error",
      result: null,
      quota: null,
      error: error instanceof Error ? error.message : String(error)
    };
    aiLogger.warn("managed_ai.summarize_failed", {
      status: outcome.status,
      error: toErrorMetadata(error)
    });
    logAiTelemetry({ status: outcome.status, durationMs: Date.now() - startedAt, error: outcome.error });
    if (outcome.status === "error") {
      captureException(error, "summarizeWithManagedAi");
    }
    return outcome;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isQuotaResponse(body: unknown): body is { error: "quota_exceeded"; quota: ManagedAiQuota } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { error?: string }).error === "quota_exceeded" &&
    typeof (body as { quota?: ManagedAiQuota }).quota === "object"
  );
}

function buildNoticesForAiOutcome(outcome: ManagedAiOutcome): SaveNotice[] {
  switch (outcome.status) {
    case "success":
    case "disabled":
      return [];
    case "quota": {
      const limit = outcome.quota?.limit ?? 0;
      return [
        {
          level: "warning",
          message: `AI quota reached${limit ? ` (${limit} per day)` : ""}. Saved without AI summary.`
        }
      ];
    }
    case "timeout":
      return [
        {
          level: "warning",
          message: "AI request timed out. Saved without AI summary."
        }
      ];
    case "error":
      return [
        {
          level: "warning",
          message: "AI summary unavailable right now. Saved without AI summary."
        }
      ];
    default:
      return [];
  }
}

type AiTelemetryEvent = {
  status: ManagedAiStatus;
  durationMs: number;
  quota?: ManagedAiQuota | null;
  error?: string;
};

function logAiTelemetry(event: AiTelemetryEvent) {
  aiLogger.info("managed_ai.telemetry", {
    status: event.status,
    durationMs: event.durationMs,
    quotaRemaining: event.quota?.remaining ?? null,
    quotaLimit: event.quota?.limit ?? null,
    error: event.error ?? null
  });
}

async function findDuplicate(urlId: string): Promise<SavedPost | undefined> {
  const savedPosts = await getSavedPosts();
  return savedPosts[urlId];
}

async function appendRowToSheet(sheetId: string, row: SheetRowInput) {
  const values = [
    row.timestamp,
    row.source,
    row.url,
    row.post_content,
    row.authorName ?? "",
    row.authorHeadline ?? "",
    row.authorCompany ?? "",
    row.authorUrl ?? "",
    row.selection ?? "",
    row.summary ?? "",
    row.tags?.join(", ") ?? "",
    row.intent ?? "",
    row.next_action ?? "",
    row.status,
    row.urlId,
    row.notes ?? ""
  ];

  const appendUrl = `${config.sheetsApiEndpoint}/${sheetId}/values/${encodeURIComponent(
    SHEET_RANGE
  )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  let token = await getAuthToken(false).catch(() => getAuthToken(true));
  try {
    await postValues(appendUrl, token, values);
  } catch (error) {
    if (error instanceof UnauthorizedError && token) {
      await removeCachedAuthToken(token);
      token = await getAuthToken(true);
      await postValues(appendUrl, token, values);
      return;
    }
    throw error;
  }
}

async function postValues(url: string, token: string, values: string[]) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ majorDimension: "ROWS", values: [values] })
    });
  } catch (error) {
    throw new Error("network_error");
  }

  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError("unauthorized");
  }

  if (!response.ok) {
    let details = "";
    try {
      const data = (await response.json()) as { error?: { message?: string } };
      details = data.error?.message ?? "";
    } catch (error) {
      logger.warn("sheets.parse_error_failed", {
        error: toErrorMetadata(error)
      });
    }
    throw new Error(`sheets_append_failed${details ? `: ${details}` : ""}`);
  }
}

async function storeSavedPost(row: SheetRowInput) {
  const savedPosts = await getSavedPosts();
  const next: Record<string, SavedPost> = {
    ...savedPosts,
    [row.urlId]: {
      urlId: row.urlId,
      url: row.url,
      post_content: row.post_content,
      selection: row.selection,
      summary: row.summary,
      status: row.status,
      authorName: row.authorName,
      authorHeadline: row.authorHeadline,
      authorCompany: row.authorCompany,
      authorUrl: row.authorUrl,
      savedAt: Date.now()
    }
  };

  const retentionCutoff = Date.now() - SAVED_POST_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const filteredEntries = Object.entries(next).filter(([, value]) => {
    if (!value?.savedAt) {
      return false;
    }
    return value.savedAt >= retentionCutoff;
  });

  const trimmedEntries = filteredEntries
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, SAVED_POSTS_LIMIT);

  await setSavedPosts(Object.fromEntries(trimmedEntries));
}

async function getSheetId(): Promise<string | undefined> {
  const value = await getFromStorage<string>(SHEET_ID_KEY);
  if (!value) {
    return undefined;
  }
  return value;
}

async function getLicenseKey(): Promise<string | undefined> {
  const value = await getFromStorage<string>(LICENSE_KEY_KEY);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function getSavedPosts(): Promise<Record<string, SavedPost>> {
  const stored = await getFromStorage<Record<string, SavedPost>>(SAVED_POSTS_KEY);
  if (!stored || typeof stored !== "object") {
    return {};
  }
  return stored;
}

async function setSavedPosts(value: Record<string, SavedPost>) {
  await chromeStorageSet(SAVED_POSTS_KEY, value);
}

async function getFromStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result[key] as T | undefined);
    });
  });
}

async function chromeStorageSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function getAuthToken(interactive: boolean): Promise<string> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) {
      throw new Error("empty_token");
    }
    return token;
  } catch (error) {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      throw runtimeError;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function removeCachedAuthToken(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function showSaveNotification(row: SheetRowInput, sheetId: string): Promise<void> {
  if (!chrome.notifications?.create) {
    return;
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  const iconUrl = chrome.runtime.getURL("public/icons/48.png");
  return new Promise((resolve, reject) => {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl,
        title: "Saved to Google Sheet",
        message: row.post_content || "Saved post"
      },
      (notificationId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }
        if (notificationId) {
          notificationLinks.set(notificationId, url);
        }
        resolve();
      }
    );
  });
}
