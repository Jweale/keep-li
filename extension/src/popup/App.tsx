import { useEffect, useState } from "react";
import { SummarizeOutput } from "@keep-li/shared";
import { z } from "zod";

const formSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  status: z.enum(["inbox", "to_use", "archived"]),
  aiEnabled: z.boolean()
});

type FormState = z.infer<typeof formSchema> & {
  highlight?: string;
  aiResult?: SummarizeOutput | null;
};

const defaultState: FormState = {
  url: "",
  title: "",
  notes: "",
  status: "inbox",
  aiEnabled: true,
  highlight: undefined,
  aiResult: null
};

export default function App() {
  const [state, setState] = useState<FormState>(defaultState);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
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

      setState((prev) => ({
        ...prev,
        url,
        title,
        highlight: selection?.trim() || undefined
      }));
    }

    bootstrap();
  }, []);

  const withState = <T extends keyof FormState>(key: T) => (
    value: FormState[T]
  ) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setMessage(null);
    const validation = formSchema.safeParse(state);
    if (!validation.success || !state.url || !state.title) {
      setMessage("Missing required fields");
      setSaving(false);
      return;
    }
    try {
      const payload = {
        ...validation.data,
        url: state.url,
        title: state.title,
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
      setMessage("Saved");
    } catch (error) {
      setMessage("Save failed");
      console.error(error);
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
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={state.title ?? ""}
            onChange={(event) => withState("title")(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-300">URL</span>
          <input
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-500"
            value={state.url ?? ""}
            readOnly
          />
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
            className="h-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={state.notes}
            onChange={(event) => withState("notes")(event.target.value)}
          />
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
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={state.status}
            onChange={(event) => withState("status")(event.target.value as FormState["status"])}
          >
            <option value="inbox">Inbox</option>
            <option value="to_use">To use</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>

      <button
        className="mt-auto rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={saving}
        onClick={handleSubmit}
      >
        {saving ? "Saving…" : "Save to Sheet"}
      </button>

      {message && <p className="text-xs text-slate-400">{message}</p>}
    </div>
  );
}
