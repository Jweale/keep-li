import {
  API_ENDPOINTS,
  canonicaliseUrl,
  computeUrlHash,
  savedPostsStorageKey,
  storageKey,
  type LocalSavedItem,
  type Intent,
  type Status,
  type SummarizeOutput
} from "@keep-li/shared";

import { config } from "../config";
import { initBrowserSentry } from "../telemetry/init-browser";
import { createLogger } from "../telemetry/logger";
import {
  initTelemetry,
  recordAiTelemetry,
  recordErrorTelemetry,
  recordInstallTelemetry,
  recordSaveTelemetry
} from "./telemetry";
import {
  ensureAccessToken,
  launchSupabaseOAuth,
  clearSession as clearSupabaseSession,
  getStoredSession
} from "./supabase-session";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SAVED_POSTS_KEY = savedPostsStorageKey(STORAGE_CONTEXT);
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const SAVED_POSTS_LIMIT = 50;
const SAVED_POST_RETENTION_DAYS = 90;
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

const deriveEmbedUrl = (canonicalUrl: string): string | null => {
  try {
    const parsed = new URL(canonicalUrl);
    if (!parsed.hostname.includes("linkedin.com")) {
      return null;
    }
    if (!parsed.pathname.includes("/feed/update/")) {
      return null;
    }
    const embedPath = parsed.pathname.replace("/feed/update/", "/embed/feed/update/");
    return `${parsed.origin}${embedPath}${parsed.search}${parsed.hash}`;
  } catch (error) {
    logger.debug("embed_url.derive_failed", {
      error: toErrorMetadata(error),
      url: canonicalUrl
    });
    return null;
  }
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

void initTelemetry();

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.notifications.clear(notificationId, () => {
      chrome.runtime.lastError;
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (sidePanel?.setPanelBehavior) {
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
  logger.info("lifecycle.installed", { reason: details.reason });

  recordInstallTelemetry(chrome.runtime.getManifest().version, details.reason);

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
    case "save-item": {
      const payload = message.payload as SaveMessagePayload;

      void handleSaveItem(payload)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error) => {
          logger.error("save.failed", {
            error: toErrorMetadata(error)
          });
          captureException(error, "handleSaveItem");
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return true;
    }
    case "supabase-session:start": {
      void launchSupabaseOAuth()
        .then((session) => {
          sendResponse({ ok: true, session });
        })
        .catch((error) => {
          logger.warn("auth.launch_failed", {
            error: toErrorMetadata(error)
          });
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }
    case "supabase-session:get": {
      void ensureAccessToken()
        .then(async (session) => {
          if (!session) {
            const stored = await getStoredSession();
            sendResponse({ ok: true, session: stored, needsRefresh: true });
            return;
          }
          sendResponse({ ok: true, session });
        })
        .catch((error) => {
          logger.warn("auth.session_check_failed", {
            error: toErrorMetadata(error)
          });
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }
    case "supabase-session:clear": {
      void clearSupabaseSession()
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          logger.warn("auth.clear_failed", {
            error: toErrorMetadata(error)
          });
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
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
  title?: string;
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
  tags?: string[];
  intent?: Intent | null;
  next_action?: string | null;
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
      item: LocalSavedItem;
      duplicate: boolean;
      ai: ManagedAiOutcome;
      notices: SaveNotice[];
    }
  | { ok: false; error: string; duplicate?: LocalSavedItem };

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

type SaveApiItem = {
  id: string;
  userId: string;
  dateAdded: string;
  source: "linkedin" | "web";
  url: string;
  urlHash: string;
  title: string;
  postContent: string;
  embedUrl: string | null;
  highlight: string | null;
  summary160: string | null;
  tags: string[];
  intent: Intent | null;
  nextAction: string | null;
  notes: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  authorCompany: string | null;
  authorUrl: string | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
};

type SaveApiSuccess = {
  ok: true;
  duplicate: boolean;
  item: SaveApiItem;
};

type SaveApiError = {
  ok: false;
  error: string;
  item?: SaveApiItem;
};

async function handleSaveItem(payload: SaveMessagePayload): Promise<SaveResponse> {
  if (!payload.url || !payload.post_content) {
    recordErrorTelemetry("save.missing_fields", "warn");
    return { ok: false, error: "missing_fields" };
  }

  const session = await ensureAccessToken();
  if (!session) {
    recordErrorTelemetry("save.unauthenticated", "error");
    return { ok: false, error: "not_authenticated" };
  }

  const canonicalUrl = canonicaliseUrl(payload.url);
  const urlHash = await computeUrlHash(canonicalUrl);
  const title = payload.title?.trim()?.slice(0, 320) || payload.post_content.slice(0, 320) || canonicalUrl;
  const embedUrl = deriveEmbedUrl(canonicalUrl);

  if (!payload.force) {
    const duplicate = await findDuplicate(urlHash);
    if (duplicate) {
      recordErrorTelemetry("save.duplicate", "info");
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

  const licenseKey = await getLicenseKey();
  const requestBody = {
    url: canonicalUrl,
    title,
    post_content: payload.post_content,
    highlight,
    status: payload.status,
    notes: payload.notes,
    aiResult: aiOutcome.result,
    force: payload.force ?? false,
    authorName: payload.authorName ?? null,
    authorHeadline: payload.authorHeadline ?? null,
    authorCompany: payload.authorCompany ?? null,
    authorUrl: payload.authorUrl ?? null,
    tags: payload.tags,
    intent: payload.intent,
    next_action: payload.next_action,
    licenseKey,
    embedUrl
  } satisfies Record<string, unknown>;

  const apiResult = await persistItem(session.accessToken, requestBody);

  if (!apiResult.ok) {
    if (apiResult.error === "unauthorized") {
      await clearSupabaseSession();
      recordErrorTelemetry("save.session_invalid", "error");
      return { ok: false, error: "not_authenticated" };
    }

    if (apiResult.error === "duplicate" && apiResult.item) {
      const localDuplicate = toLocalSavedItem(apiResult.item);
      await storeSavedItem(localDuplicate);
      return { ok: false, error: "duplicate", duplicate: localDuplicate };
    }

    recordErrorTelemetry("save.api_failed", "error");
    return { ok: false, error: apiResult.error };
  }

  const localItem = toLocalSavedItem(apiResult.item);
  await storeSavedItem(localItem);
  const notices = buildNoticesForAiOutcome(aiOutcome);
  recordSaveTelemetry(aiOutcome.status);

  await showSaveNotification(localItem).catch((error) => {
    logger.warn("notification.show_failed", {
      error: toErrorMetadata(error),
      itemId: localItem.id,
      urlHash
    });
  });

  return {
    ok: true,
    item: localItem,
    duplicate: apiResult.duplicate,
    ai: aiOutcome,
    notices
  };
}

function toLocalSavedItem(item: SaveApiItem): LocalSavedItem {
  return {
    id: item.id,
    url: item.url,
    urlHash: item.urlHash,
    title: item.title,
    postContent: item.postContent,
    embedUrl: item.embedUrl,
    highlight: item.highlight,
    summary160: item.summary160,
    status: item.status,
    tags: Array.isArray(item.tags) ? item.tags : [],
    intent: item.intent ?? null,
    nextAction: item.nextAction ?? null,
    notes: item.notes ?? null,
    authorName: item.authorName ?? null,
    authorHeadline: item.authorHeadline ?? null,
    authorCompany: item.authorCompany ?? null,
    authorUrl: item.authorUrl ?? null,
    savedAt: Date.now()
  } satisfies LocalSavedItem;
}

async function persistItem(accessToken: string, payload: Record<string, unknown>): Promise<SaveApiSuccess | SaveApiError> {
  const endpoint = `${config.apiEndpoint}${API_ENDPOINTS.SAVE}`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const body = (await response.json().catch(() => ({}))) as SaveApiSuccess | SaveApiError;

    if (response.status === 401) {
      return { ok: false, error: "unauthorized" };
    }

    if (response.status === 409) {
      return { ok: false, error: "duplicate", item: (body as SaveApiError).item };
    }

    if (!response.ok || !body.ok) {
      const error = (body as SaveApiError).error ?? `save_failed_${response.status}`;
      return { ok: false, error };
    }

    return body as SaveApiSuccess;
  } catch (error) {
    logger.error("save.api_exception", {
      error: error instanceof Error ? error.message : String(error)
    });
    return { ok: false, error: "network_error" };
  }
}

type ManagedAiArgs = {
  url: string;
  post_content: string;
  highlight?: string | null;
};

type ManagedAiResponse = Partial<SummarizeOutput> & {
  quota?: ManagedAiQuota | null;
};

const isIntent = (value: unknown): value is Intent =>
  value === "learn" || value === "post_idea" || value === "outreach" || value === "research";

const sanitizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 16);
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
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
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

      if (response.status === 429 && body && typeof body === "object" && body !== null) {
        const quota = (body as { quota?: ManagedAiQuota | null }).quota ?? null;
        const outcome: ManagedAiOutcome = {
          status: "quota",
          result: null,
          quota,
          error: "quota_exceeded"
        };
        recordAiTelemetry(outcome.status, Date.now() - startedAt);
        return outcome;
      }

      const errorText = typeof body === "string" ? body : JSON.stringify(body);
      const outcome: ManagedAiOutcome = {
        status: "error",
        result: null,
        quota: null,
        error: errorText
      };
      recordAiTelemetry(outcome.status, Date.now() - startedAt);
      return outcome;
    }

    const data = (await response.json()) as ManagedAiResponse;
    if (typeof data.summary_160 !== "string") {
      const outcome: ManagedAiOutcome = {
        status: "error",
        result: null,
        quota: data.quota ?? null,
        error: "invalid_response"
      };
      recordAiTelemetry(outcome.status, Date.now() - startedAt);
      return outcome;
    }

    const result: SummarizeOutput = {
      summary_160: data.summary_160,
      tags: sanitizeTags(data.tags),
      intent: isIntent(data.intent) ? data.intent : "learn",
      next_action: typeof data.next_action === "string" ? data.next_action : "",
      tokens_in: typeof data.tokens_in === "number" ? data.tokens_in : 0,
      tokens_out: typeof data.tokens_out === "number" ? data.tokens_out : 0
    } satisfies SummarizeOutput;

    const outcome: ManagedAiOutcome = {
      status: "success",
      result,
      quota: data.quota ?? null
    };
    recordAiTelemetry(outcome.status, Date.now() - startedAt);
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
    recordAiTelemetry(outcome.status, Date.now() - startedAt);
    if (outcome.status === "error") {
      captureException(error, "summarizeWithManagedAi");
    }
    return outcome;
  } finally {
    clearTimeout(timeoutId);
  }
}

const buildNoticesForAiOutcome = (outcome: ManagedAiOutcome): SaveNotice[] => {
  switch (outcome.status) {
    case "quota":
      return [
        {
          level: "warning",
          message: "AI quota reached. Saved without a summary."
        }
      ];
    case "timeout":
      return [
        {
          level: "warning",
          message: "AI summary timed out. Saved without a summary."
        }
      ];
    case "error":
      return [
        {
          level: "warning",
          message: "AI summary failed. Saved without a summary."
        }
      ];
    default:
      return [];
  }
};

async function showSaveNotification(item: LocalSavedItem): Promise<void> {
  if (!chrome.notifications?.create) {
    return;
  }

  const notificationId = `keep-li-save-${Date.now()}`;
  const message = `Saved with status ${item.status}.`;

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Saved to Keep-li",
    message
  });
}

async function findDuplicate(urlHash: string): Promise<LocalSavedItem | undefined> {
  const savedPosts = await getSavedItems();
  return savedPosts[urlHash];
}

async function storeSavedItem(item: LocalSavedItem) {
  const savedPosts = await getSavedItems();
  const next: Record<string, LocalSavedItem> = {
    ...savedPosts,
    [item.urlHash]: {
      ...item,
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

  await setSavedItems(Object.fromEntries(trimmedEntries));
}

async function getSavedItems(): Promise<Record<string, LocalSavedItem>> {
  const stored = await getFromStorage<Record<string, LocalSavedItem>>(SAVED_POSTS_KEY);
  if (!stored || typeof stored !== "object") {
    return {};
  }
  return stored;
}

async function setSavedItems(value: Record<string, LocalSavedItem>) {
  await chromeStorageSet(SAVED_POSTS_KEY, value);
}

async function getLicenseKey(): Promise<string | undefined> {
  const value = await getFromStorage<string>(LICENSE_KEY_KEY);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
