import { canonicaliseUrl, computeUrlHash } from "@keep-li/shared";

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

  const payload = message.payload as {
    url?: string;
    title?: string;
    highlight?: string;
    status: "inbox" | "to_use" | "archived";
    notes?: string;
    aiEnabled?: boolean;
  };

  if (!payload.url || !payload.title) {
    sendResponse({ ok: false, error: "missing_fields" });
    return true;
  }

  prepareSheetPayload({
    url: payload.url,
    title: payload.title,
    highlight: payload.highlight,
    status: payload.status,
    notes: payload.notes
  })
    .then((row) => {
      console.info("Prepared payload", row);
      // TODO: integrate Google Sheets append + AI orchestration
      sendResponse({ ok: true, row });
    })
    .catch((error) => {
      console.error("Failed to prepare row", error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});

export async function prepareSheetPayload(input: {
  url: string;
  title: string;
  highlight?: string;
  status: "inbox" | "to_use" | "archived";
  notes?: string;
}) {
  const canonicalUrl = canonicaliseUrl(input.url);
  const urlHash = await computeUrlHash(canonicalUrl);

  return {
    date_added: new Date().toISOString(),
    source: canonicalUrl.includes("linkedin.com") ? "linkedin" : "web",
    url: canonicalUrl,
    title: input.title,
    highlight: input.highlight,
    status: input.status,
    url_hash: urlHash,
    notes: input.notes
  };
}
