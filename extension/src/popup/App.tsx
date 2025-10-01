import { useEffect, useRef, useState } from "react";
import { DEFAULT_STATUS, STATUSES, SummarizeOutput, storageKey, type SavedPost } from "@keep-li/shared";
import { z } from "zod";

import { config } from "../config";

const statusValues = STATUSES;

const formSchema = z.object({
  url: z
    .string({ required_error: "URL is required" })
    .url("Enter a valid URL"),
  post_content: z
    .string({ required_error: "Post content is required" })
    .min(1, "Post content is required"),
  notes: z.string().optional(),
  status: z.enum(statusValues),
  aiEnabled: z.boolean()
});

type AuthorFields = {
  authorName: string | null;
  authorHeadline: string | null;
  authorCompany: string | null;
  authorUrl: string | null;
};

type FormState = z.infer<typeof formSchema> & {
  highlight?: string;
  aiResult?: SummarizeOutput | null;
} &
  AuthorFields;

type FieldErrorKey = "post_content" | "url" | "notes" | "status";
type MessageAction = "open-sheet" | "retry" | "reconnect" | "save-anyway";
type Message = { variant: "success" | "error" | "warning"; text: string; actions?: MessageAction[] };

const defaultState: FormState = {
  url: "",
  post_content: "",
  notes: "",
  status: DEFAULT_STATUS,
  aiEnabled: true,
  highlight: undefined,
  aiResult: null,
  authorName: null,
  authorHeadline: null,
  authorCompany: null,
  authorUrl: null
};

const fieldErrorKeys = ["post_content", "url", "notes", "status"] as const;
const LAST_STATUS_KEY = storageKey("LAST_STATUS", { environment: config.environment });
const SHEET_ID_KEY = storageKey("SHEET_ID", { environment: config.environment });

type PendingMetadata = Partial<
  Pick<FormState, "url" | "post_content" | "authorName" | "authorHeadline" | "authorCompany" | "authorUrl">
>;

function isFieldErrorKey(key: keyof FormState): key is FieldErrorKey {
  return (fieldErrorKeys as readonly string[]).includes(key as string);
}

function isStatus(value: unknown): value is FormState["status"] {
  return statusValues.includes(value as FormState["status"]);
}

function sanitiseMetadataValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function App() {
  const [state, setState] = useState<FormState>(defaultState);
  const [errors, setErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [duplicatePost, setDuplicatePost] = useState<SavedPost | null>(null);
  const [metadataWarning, setMetadataWarning] = useState<string | null>(null);
  const postContentInputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastForceRef = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      postContentInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        const tabUrl = tab?.url ?? "";
        const tabTitle = tab?.title ?? "";

        let metadata: PendingMetadata | null = null;
        try {
          const response = await chrome.runtime.sendMessage({
            type: "consume-capture-metadata",
            tabId
          });
          if (response?.metadata) {
            metadata = response.metadata as PendingMetadata;
          }
        } catch (error) {
          console.warn("Metadata retrieval failed", error);
        }

        let selection = "";
        if (tabId) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => window.getSelection()?.toString() ?? ""
            });
            selection = results.map((result) => result.result).join(" ");
          } catch (error) {
            console.warn("Selection retrieval failed", error);
          }
        }

        let storedStatus: FormState["status"] | undefined;
        let storedSheetId: string | null = null;
        try {
          const stored = await chrome.storage.local.get([LAST_STATUS_KEY, SHEET_ID_KEY]);
          const candidateStatus = stored[LAST_STATUS_KEY];
          if (isStatus(candidateStatus)) {
            storedStatus = candidateStatus;
          }
          const candidateSheet = stored[SHEET_ID_KEY];
          if (typeof candidateSheet === "string") {
            storedSheetId = candidateSheet;
          }
        } catch (error) {
          console.warn("Storage retrieval failed", error);
        }

        if (!active) {
          return;
        }

        const trimmedSelection = selection.trim();
        const resolvedUrl = metadata?.url && metadata.url.length > 0 ? metadata.url : tabUrl;
        const resolvedPostContent =
          metadata?.post_content && metadata.post_content.length > 0 ? metadata.post_content : tabTitle;
        const sanitizedAuthorName = sanitiseMetadataValue(metadata?.authorName);
        const sanitizedAuthorHeadline = sanitiseMetadataValue(metadata?.authorHeadline);
        const sanitizedAuthorCompany = sanitiseMetadataValue(metadata?.authorCompany);
        const sanitizedAuthorUrl = sanitiseMetadataValue(metadata?.authorUrl);

        setState((prev) => ({
          ...prev,
          url: resolvedUrl,
          post_content: resolvedPostContent,
          highlight: trimmedSelection ? trimmedSelection : undefined,
          status: storedStatus ?? prev.status,
          authorName: sanitizedAuthorName,
          authorHeadline: sanitizedAuthorHeadline,
          authorCompany: sanitizedAuthorCompany,
          authorUrl: sanitizedAuthorUrl
        }));

        setSheetId(storedSheetId);

        let warning: string | null = null;
        if (!metadata) {
          warning =
            "We couldn't automatically capture LinkedIn post details. Double-check the post is fully visible, or fill the fields manually.";
        } else {
          const missingContent = !metadata.post_content || metadata.post_content.trim().length === 0;
          const missingAuthor =
            !sanitizedAuthorName && !sanitizedAuthorHeadline && !sanitizedAuthorCompany && !sanitizedAuthorUrl;
          if (missingContent || missingAuthor) {
            warning =
              "Some post details couldn't be captured automatically. Please review the content before saving.";
          }
        }
        setMetadataWarning(warning);
      } catch (error) {
        if (!active) {
          return;
        }
        console.error("Capture bootstrap failed", error);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const withState = <T extends keyof FormState>(key: T) => (value: FormState[T]) => {
    setState((prev) => ({ ...prev, [key]: value }));
    if (isFieldErrorKey(key)) {
      setErrors((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    setMessage(null);
    setDuplicatePost(null);
  };

  const persistStatus = async (value: FormState["status"]) => {
    try {
      await chrome.storage.local.set({ [LAST_STATUS_KEY]: value });
    } catch (error) {
      console.warn("Status persistence failed", error);
    }
  };

  const handleStatusChange = (value: string) => {
    if (!isStatus(value)) {
      return;
    }
    withState("status")(value);
    void persistStatus(value);
  };

  const handleSubmit = async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    lastForceRef.current = force;
    setSaving(true);
    setMessage(null);
    setErrors({});
    setDuplicatePost(null);
    const validation = formSchema.safeParse(state);
    if (!validation.success) {
      const { fieldErrors } = validation.error.flatten();
      const nextErrors: Partial<Record<FieldErrorKey, string>> = {};
      for (const key of fieldErrorKeys) {
        const errorMessage = fieldErrors[key]?.[0];
        if (errorMessage) {
          nextErrors[key] = errorMessage;
        }
      }
      setErrors(nextErrors);
      setMessage({ variant: "error", text: "Please fix the errors below." });
      setSaving(false);
      return;
    }
    try {
      const payload = {
        ...validation.data,
        highlight: state.highlight,
        aiResult: state.aiResult,
        force,
        authorName: state.authorName ?? null,
        authorHeadline: state.authorHeadline ?? null,
        authorCompany: state.authorCompany ?? null,
        authorUrl: state.authorUrl ?? null
      };

      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "save-to-sheet",
            payload
          },
          (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
              reject(err);
              return;
            }
            if (response?.ok) {
              resolve(response);
            } else {
              reject(response ?? new Error("Unknown error"));
            }
          }
        );
      });
      setMessage({
        variant: "success",
        text: "Saved to Google Sheet.",
        actions: sheetId ? ["open-sheet"] : undefined
      });
    } catch (error) {
      console.error(error);
      if (error && typeof error === "object" && "error" in (error as Record<string, unknown>)) {
        const payloadError = (error as { error?: string; duplicate?: SavedPost }).error;
        const duplicate = (error as { duplicate?: SavedPost }).duplicate;
        if (payloadError === "duplicate" && duplicate) {
          setDuplicatePost(duplicate);
          setMessage({
            variant: "warning",
            text: "This post has already been saved.",
            actions: sheetId ? ["save-anyway", "open-sheet"] : ["save-anyway"]
          });
          setSaving(false);
          return;
        }
        if (payloadError === "missing_sheet_id") {
          setMessage({
            variant: "error",
            text: "Google Sheet ID is missing. Add it via onboarding before saving again."
          });
          setSaving(false);
          return;
        }
        if (payloadError === "network_error") {
          setMessage({
            variant: "error",
            text: "Network error occurred. Check your connection and retry.",
            actions: ["retry"]
          });
          setSaving(false);
          return;
        }
        if (payloadError && payloadError.includes("unauthorized")) {
          setMessage({
            variant: "error",
            text: "Google authorization expired. Reconnect to continue.",
            actions: ["reconnect"]
          });
          setSaving(false);
          return;
        }
        if (payloadError && payloadError.startsWith("sheets_append_failed")) {
          setMessage({
            variant: "error",
            text: "Sheets API rejected the request. Open the sheet to verify headers and retry.",
            actions: sheetId ? ["open-sheet", "retry"] : ["retry"]
          });
          setSaving(false);
          return;
        }
      }
      setMessage({
        variant: "error",
        text: "Save failed. Please try again.",
        actions: ["retry"]
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = async () => {
    setMessage(null);
    try {
      setSaving(true);
      const result = await chrome.identity.getAuthToken({ interactive: true });
      const token = typeof result === "string" ? result : result?.token;
      if (!token) {
        throw new Error("empty_token");
      }
      await handleSubmit({ force: lastForceRef.current });
    } catch (error) {
      console.error("Reconnect failed", error);
      setMessage({
        variant: "error",
        text: "Reconnect failed. Please try again.",
        actions: ["reconnect"]
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenSheet = async () => {
    if (!sheetId) {
      return;
    }
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
    try {
      await chrome.tabs.create({ url });
    } catch (error) {
      console.warn("Failed to open sheet", error);
    }
  };

  const handleMessageAction = (action: MessageAction) => {
    switch (action) {
      case "open-sheet":
        void handleOpenSheet();
        break;
      case "retry":
        void handleSubmit({ force: lastForceRef.current });
        break;
      case "reconnect":
        void handleReconnect();
        break;
      case "save-anyway":
        void handleSubmit({ force: true });
        break;
      default:
        break;
    }
  };

  const actionLabel = (action: MessageAction) => {
    switch (action) {
      case "open-sheet":
        return "Open Sheet";
      case "retry":
        return "Retry";
      case "reconnect":
        return "Reconnect";
      case "save-anyway":
        return "Save anyway";
      default:
        return action;
    }
  };

  const hasAuthorDetails = Boolean(
    state.authorName || state.authorHeadline || state.authorCompany || state.authorUrl
  );

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keep-li-panel-title"
      className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col gap-4 overflow-y-auto bg-background p-4 text-text"
    >
      <header className="flex flex-col gap-1">
        <h1 id="keep-li-panel-title" className="text-lg font-semibold">
          Keep your saved LinkedIn posts in one place 
        </h1>
        <p className="text-xs text-text/70">Helps you turn every interesting LinkedIn post into an organised, searchable, AI-tagged knowledge base.</p>
      </header>

      {metadataWarning && (
        <div className="rounded-md border border-amber-500/60 bg-amber-100/70 p-3 text-xs text-amber-900">
          {metadataWarning}
        </div>
      )}

      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-text/80">
            <span>Post URL</span>
            {state.url && (
              <a
                className="text-xs font-medium text-primary underline-offset-4 hover:text-accent-teal"
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
            )}
          </span>
          <input
            className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
              errors.url
                ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                : "border-accent-aqua/70"
            } bg-background/70 text-text/80`}
            value={state.url ?? ""}
            readOnly
            aria-invalid={Boolean(errors.url)}
          />
          {errors.url && <span className="text-xs text-red-400">{errors.url}</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text/80">Post Content</span>
          <textarea
            ref={postContentInputRef}
            className={`min-h-[140px] rounded-md border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
              errors.post_content
                ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                : "border-accent-aqua/70"
            } bg-white`}
            value={state.post_content ?? ""}
            onChange={(event) => withState("post_content")(event.target.value)}
            aria-invalid={Boolean(errors.post_content)}
          />
          {errors.post_content && <span className="text-xs text-red-400">{errors.post_content}</span>}
        </label>

        {hasAuthorDetails && (
          <section
            className="rounded-md border border-accent-teal/40 bg-accent-aqua/60 p-3 text-sm text-text"
            aria-label="Author details"
          >
            <div className="flex flex-col gap-1">
              {state.authorName && <p className="text-base font-semibold text-text">{state.authorName}</p>}
              {state.authorHeadline && <p className="text-text/80">{state.authorHeadline}</p>}
              {state.authorCompany && <p className="text-xs text-text/70">{state.authorCompany}</p>}
              {state.authorUrl && (
                <a
                  className="text-xs font-medium text-primary underline-offset-4 hover:text-accent-teal"
                  href={state.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View profile
                </a>
              )}
            </div>
          </section>
        )}

        {state.highlight && (
          <div className="flex flex-col gap-1">
            <span className="text-text/80">Highlight</span>
            <textarea
              className="h-24 rounded-md border border-accent-aqua/70 bg-accent-aqua/40 px-3 py-2 text-sm text-text"
              value={state.highlight}
              readOnly
            />
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-text/80">Notes</span>
          <textarea
            className={`h-24 rounded-md border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
              errors.notes
                ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                : "border-accent-aqua/70"
            } bg-white`}
            value={state.notes}
            onChange={(event) => withState("notes")(event.target.value)}
            aria-invalid={Boolean(errors.notes)}
          />
          {errors.notes && <span className="text-xs text-red-400">{errors.notes}</span>}
        </label>

        <label className="flex items-center gap-2 text-sm text-text/90">
          <input
            type="checkbox"
            checked={state.aiEnabled}
            onChange={(event) => withState("aiEnabled")(event.target.checked)}
          />
          <span>Add AI summary &amp; tags</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text/80">Status</span>
          <select
            className={`rounded-md border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
              errors.status
                ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                : "border-accent-aqua/70"
            } bg-white`}
            value={state.status}
            onChange={(event) => handleStatusChange(event.target.value)}
            aria-invalid={Boolean(errors.status)}
          >
            <option value="inbox">Inbox</option>
            <option value="to_use">To use</option>
            <option value="archived">Archived</option>
          </select>
          {errors.status && <span className="text-xs text-red-400">{errors.status}</span>}
        </label>
      </div>

      <button
        className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-accent-teal disabled:opacity-60"
        disabled={saving}
        onClick={() => handleSubmit()}
      >
        {saving ? "Saving…" : "Save to Sheet"}
      </button>

      {duplicatePost && (
        <div className="rounded border border-amber-500 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-semibold">Already saved</p>
          <p className="mt-1 break-words text-amber-100/80">
            Saved on {new Date(duplicatePost.savedAt).toLocaleString()} with status &quot;{duplicatePost.status}&quot;.
          </p>
        </div>
      )}

      {message && (
        <div
          className={`flex flex-col gap-2 rounded border px-3 py-2 text-xs ${
            message.variant === "success"
              ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
              : message.variant === "warning"
                ? "border-amber-600 bg-amber-500/10 text-amber-100"
                : "border-red-600 bg-red-500/10 text-red-200"
          }`}
        >
          <span>{message.text}</span>
          {message.actions && message.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.actions.map((action) => (
                <button
                  key={action}
                  className="rounded border border-current px-2 py-1 text-xs font-medium"
                  onClick={() => handleMessageAction(action)}
                >
                  {actionLabel(action)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
