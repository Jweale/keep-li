import { useEffect, useRef, useState } from "react";
import { DEFAULT_STATUS, STATUSES, SummarizeOutput, storageKey, type SavedPost } from "@keep-li/shared";
import { z } from "zod";

import { config } from "../config";

const statusValues = STATUSES;

const formSchema = z.object({
  url: z
    .string({ required_error: "URL is required" })
    .url("Enter a valid URL"),
  title: z
    .string({ required_error: "Title is required" })
    .min(1, "Title is required"),
  notes: z.string().optional(),
  status: z.enum(statusValues),
  aiEnabled: z.boolean()
});

type FormState = z.infer<typeof formSchema> & {
  highlight?: string;
  aiResult?: SummarizeOutput | null;
};

type FieldErrorKey = "title" | "url" | "notes" | "status";
type MessageAction = "open-sheet" | "retry" | "reconnect" | "save-anyway";
type Message = { variant: "success" | "error" | "warning"; text: string; actions?: MessageAction[] };

const defaultState: FormState = {
  url: "",
  title: "",
  notes: "",
  status: DEFAULT_STATUS,
  aiEnabled: true,
  highlight: undefined,
  aiResult: null
};

const fieldErrorKeys = ["title", "url", "notes", "status"] as const;
const LAST_STATUS_KEY = storageKey("LAST_STATUS", { environment: config.environment });
const SHEET_ID_KEY = storageKey("SHEET_ID", { environment: config.environment });

function isFieldErrorKey(key: keyof FormState): key is FieldErrorKey {
  return (fieldErrorKeys as readonly string[]).includes(key as string);
}

function isStatus(value: unknown): value is FormState["status"] {
  return statusValues.includes(value as FormState["status"]);
}

export default function App() {
  const [state, setState] = useState<FormState>(defaultState);
  const [errors, setErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [duplicatePost, setDuplicatePost] = useState<SavedPost | null>(null);
  const lastForceRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url ?? "";
        const title = tab?.title ?? "";

        let selection = "";
        if (tab?.id) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => window.getSelection()?.toString() ?? ""
            });
            selection = results.map((result) => result.result).join(" ");
          } catch (error) {
            console.warn("Selection retrieval failed", error);
          }
        }

        let storedStatus: FormState["status"] | undefined;
        try {
          const stored = await chrome.storage.local.get([LAST_STATUS_KEY, SHEET_ID_KEY]);
          const candidateStatus = stored[LAST_STATUS_KEY];
          if (isStatus(candidateStatus)) {
            storedStatus = candidateStatus;
          }
          const candidateSheet = stored[SHEET_ID_KEY];
          if (typeof candidateSheet === "string") {
            setSheetId(candidateSheet);
          }
        } catch (error) {
          console.warn("Storage retrieval failed", error);
        }

        if (!active) {
          return;
        }

        const trimmed = selection.trim();
        setState((prev) => ({
          ...prev,
          url,
          title,
          highlight: trimmed ? trimmed : undefined,
          status: storedStatus ?? prev.status
        }));
      } catch (error) {
        if (!active) {
          return;
        }
        console.error("Popup bootstrap failed", error);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const withState = <T extends keyof FormState>(key: T) => (
    value: FormState[T]
  ) => {
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
        const message = fieldErrors[key]?.[0];
        if (message) {
          nextErrors[key] = message;
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
        force
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

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-slate-950 p-4 text-slate-100">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Save to Google Sheet</h1>
        <p className="text-xs text-slate-400">
          Tip: select a LinkedIn post snippet for better AI tags.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">Title</span>
          <input
            className={`rounded border bg-slate-900 px-2 py-1 text-slate-100 focus:outline-none ${
              errors.title ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-slate-500"
            }`}
            value={state.title ?? ""}
            onChange={(event) => withState("title")(event.target.value)}
            aria-invalid={Boolean(errors.title)}
          />
          {errors.title && <span className="text-xs text-red-400">{errors.title}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">URL</span>
          <input
            className={`rounded border bg-slate-900 px-2 py-1 text-slate-500 focus:outline-none ${
              errors.url ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-slate-500"
            }`}
            value={state.url ?? ""}
            readOnly
            aria-invalid={Boolean(errors.url)}
          />
          {errors.url && <span className="text-xs text-red-400">{errors.url}</span>}
        </label>

        {state.highlight && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Highlight</span>
            <textarea
              className="h-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
              value={state.highlight}
              readOnly
            />
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">Notes</span>
          <textarea
            className={`h-20 rounded border bg-slate-900 px-2 py-1 text-slate-100 focus:outline-none ${
              errors.notes ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-slate-500"
            }`}
            value={state.notes}
            onChange={(event) => withState("notes")(event.target.value)}
            aria-invalid={Boolean(errors.notes)}
          />
          {errors.notes && <span className="text-xs text-red-400">{errors.notes}</span>}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.aiEnabled}
            onChange={(event) => withState("aiEnabled")(event.target.checked)}
          />
          <span>Add AI summary &amp; tags</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">Status</span>
          <select
            className={`rounded border bg-slate-900 px-2 py-1 text-slate-100 focus:outline-none ${
              errors.status ? "border-red-500 focus:border-red-400" : "border-slate-700 focus:border-slate-500"
            }`}
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
        className="mt-auto rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
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
