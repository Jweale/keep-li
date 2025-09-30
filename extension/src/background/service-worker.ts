import {
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

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SAVED_POSTS_KEY = savedPostsStorageKey(STORAGE_CONTEXT);
const SHEET_ID_KEY = storageKey("SHEET_ID", STORAGE_CONTEXT);
const SHEET_RANGE = "Saves!A1:L1";
const SAVED_POSTS_LIMIT = 50;
const notificationLinks = new Map<string, string>();

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const target = notificationLinks.get(notificationId);
    if (!target) {
      return;
    }
    chrome.tabs.create({ url: target }).catch((error) => {
      console.warn("Failed to open sheet from notification", error);
    });
    chrome.notifications.clear(notificationId, () => {
      chrome.runtime.lastError;
    });
    notificationLinks.delete(notificationId);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("Keep-LI extension installed");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_popup") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  chrome.action.openPopup();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "save-to-sheet") {
    return false;
  }

  const payload = message.payload as SaveMessagePayload;

  void handleSaveToSheet(payload)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      console.error("Failed to save", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

type SaveMessagePayload = {
  url?: string;
  title?: string;
  highlight?: string;
  status: Status;
  notes?: string;
  aiEnabled?: boolean;
  aiResult?: SummarizeOutput | null;
  force?: boolean;
};

type SaveResponse =
  | { ok: true; row: SheetRowInput }
  | { ok: false; error: string; duplicate?: SavedPost };

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function handleSaveToSheet(payload: SaveMessagePayload): Promise<SaveResponse> {
  if (!payload.url || !payload.title) {
    return { ok: false, error: "missing_fields" };
  }

  const sheetId = await getSheetId();
  if (!sheetId) {
    return { ok: false, error: "missing_sheet_id" };
  }

  const force = Boolean(payload.force);
  const row = await prepareSheetRow({
    url: payload.url,
    title: payload.title,
    highlight: payload.highlight,
    status: payload.status,
    notes: payload.notes,
    aiResult: payload.aiResult ?? null
  });

  if (!force) {
    const duplicate = await findDuplicate(row.urlId);
    if (duplicate) {
      return { ok: false, error: "duplicate", duplicate };
    }
  }

  await appendRowToSheet(sheetId, row);
  await storeSavedPost(row);
  await showSaveNotification(row, sheetId).catch((error) => {
    console.warn("Notification failed", error);
  });

  console.info("Row appended to sheet", { sheetId, urlId: row.urlId });
  return { ok: true, row };
}

export async function prepareSheetRow(input: {
  url: string;
  title: string;
  highlight?: string;
  status: Status;
  notes?: string;
  aiResult: SummarizeOutput | null;
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
    title: input.title,
    selection: highlight ? highlight : null,
    status: input.status,
    summary: ai?.summary_160 ?? null,
    tags: ai?.tags,
    intent: ai?.intent,
    next_action: ai?.next_action,
    notes: input.notes
  } satisfies SheetRowInput;
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
    row.title,
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
      console.warn("Failed to parse error response", error);
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
      title: row.title,
      selection: row.selection,
      summary: row.summary,
      status: row.status,
      savedAt: Date.now()
    }
  };

  const trimmedEntries = Object.entries(next)
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
        message: row.title || "Saved post"
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
