import { useEffect, useState } from "react";
import { DEFAULT_STATUS, STATUSES, SummarizeOutput, storageKey } from "@keep-li/shared";
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
type Message = { variant: "success" | "error"; text: string };

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
          const stored = await chrome.storage.local.get(LAST_STATUS_KEY);
          const candidate = stored[LAST_STATUS_KEY];
          if (isStatus(candidate)) {
            storedStatus = candidate;
          }
        } catch (error) {
          console.warn("Status retrieval failed", error);
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

  const handleSubmit = async () => {
    setSaving(true);
    setMessage(null);
    setErrors({});
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
        aiResult: state.aiResult
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
              reject(response?.error ?? new Error("Unknown error"));
            }
          }
        );
      });
      setMessage({ variant: "success", text: "Saved" });
    } catch (error) {
      console.error(error);
      setMessage({ variant: "error", text: "Save failed" });
    } finally {
      setSaving(false);
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
        onClick={handleSubmit}
      >
        {saving ? "Saving…" : "Save to Sheet"}
      </button>

      {message && (
        <p
          className={`text-xs ${
            message.variant === "success" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
