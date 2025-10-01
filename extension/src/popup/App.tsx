import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATUS, STATUSES, SummarizeOutput, storageKey, type SavedPost } from "@keep-li/shared";
import { z } from "zod";
import { Sparkles, Sheet } from "lucide-react";

import { config } from "../config";
import { resolveAsset } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

type SaveSuccessResponse = {
  ok: true;
  ai: {
    status: "disabled" | "success" | "timeout" | "quota" | "error";
    result: SummarizeOutput | null;
    quota?: { limit: number; remaining: number; count: number } | null;
  };
  notices: Array<{ level: "info" | "warning"; message: string }>;
};

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
const AI_ENABLED_KEY = storageKey("AI_ENABLED", { environment: config.environment });

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
        if (tabId && tabUrl && !tabUrl.startsWith("chrome://") && !tabUrl.startsWith("chrome-extension://")) {
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
        let storedAiEnabled: boolean | undefined;
        try {
          const stored = await chrome.storage.local.get([LAST_STATUS_KEY, SHEET_ID_KEY, AI_ENABLED_KEY]);
          const candidateStatus = stored[LAST_STATUS_KEY];
          if (isStatus(candidateStatus)) {
            storedStatus = candidateStatus;
          }
          const candidateSheet = stored[SHEET_ID_KEY];
          if (typeof candidateSheet === "string") {
            storedSheetId = candidateSheet;
          }
          const candidateAiEnabled = stored[AI_ENABLED_KEY];
          if (typeof candidateAiEnabled === "boolean") {
            storedAiEnabled = candidateAiEnabled;
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
          authorUrl: sanitizedAuthorUrl,
          aiEnabled: storedAiEnabled ?? prev.aiEnabled
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

  const persistAiEnabled = async (value: boolean) => {
    try {
      await chrome.storage.local.set({ [AI_ENABLED_KEY]: value });
    } catch (error) {
      console.warn("AI toggle persistence failed", error);
    }
  };

  const handleStatusChange = (value: string) => {
    if (!isStatus(value)) {
      return;
    }
    withState("status")(value);
    void persistStatus(value);
  };

  const handleAiToggle = (value: boolean) => {
    withState("aiEnabled")(value);
    if (!value) {
      setState((prev) => ({ ...prev, aiResult: null }));
    }
    void persistAiEnabled(value);
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

      const serviceResponse = await new Promise<SaveSuccessResponse>((resolve, reject) => {
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
              resolve(response as SaveSuccessResponse);
            } else {
              reject(response ?? new Error("Unknown error"));
            }
          }
        );
      });

      if (serviceResponse.ai.status === "success" && serviceResponse.ai.result) {
        setState((prev) => ({ ...prev, aiResult: serviceResponse.ai.result }));
      } else if (serviceResponse.ai.status !== "disabled") {
        setState((prev) => ({ ...prev, aiResult: null }));
      }

      const warningNotice = serviceResponse.notices.find((notice) => notice.level === "warning");
      const baseText = "Saved to Google Sheet.";
      const messageText = warningNotice ? `${baseText} ${warningNotice.message}` : baseText;
      const messageVariant: Message["variant"] = warningNotice ? "warning" : "success";

      setMessage({
        variant: messageVariant,
        text: messageText,
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

  const logoIconUrl = useMemo(() => resolveAsset("branding/keep-li_logo_icon.png"), []);
  const statusOptions: Array<{ value: FormState["status"]; label: string }> = [
    { value: "inbox", label: "Inbox" },
    { value: "to_use", label: "To use" },
    { value: "archived", label: "Archived" }
  ];

  return (
    <div className="relative flex min-h-screen w-full justify-center bg-gradient-to-br from-[#F2E7DC] via-[#f6f2eb] to-white px-4 py-6 text-text">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-li-panel-title"
        className="relative z-10 flex w-full max-w-[460px] flex-col gap-5"
      >
        <header className="flex items-center gap-4 rounded-3xl border border-white/60 bg-white/70 px-5 py-4 shadow-brand backdrop-blur">
          <img src={logoIconUrl} alt="Keep-li icon" className="h-12 w-12 flex-shrink-0 rounded-xl border border-primary/20 shadow-sm" />
          <div className="flex flex-col">
            <span className="font-heading text-lg font-semibold text-text">Capture to Keep-li</span>
            <span className="text-xs text-text/70">Two clicks. Instant insights. Effortless capture.</span>
          </div>
        </header>

        {metadataWarning && (
          <div className="glass-card border-amber-200/80 bg-amber-50/80 p-4 text-xs text-amber-900">
            {metadataWarning}
          </div>
        )}

        <Card className="p-6">
          <CardHeader>
            <CardTitle id="keep-li-panel-title">Save this LinkedIn inspiration</CardTitle>
            <CardDescription>
              Keep everything structured, searchable, and AI-tagged in your Google Sheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-5 text-sm">
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span>Post URL</span>
                {state.url && (
                  <a
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent-teal"
                    href={state.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Sheet className="h-3.5 w-3.5" /> Open
                  </a>
                )}
              </Label>
              <Input value={state.url ?? ""} readOnly aria-invalid={Boolean(errors.url)} />
              {errors.url && <p className="text-xs text-red-500">{errors.url}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="post-content">Post content</Label>
              <Textarea
                id="post-content"
                ref={postContentInputRef}
                value={state.post_content ?? ""}
                onChange={(event) => withState("post_content")(event.target.value)}
                aria-invalid={Boolean(errors.post_content)}
              />
              {errors.post_content && <p className="text-xs text-red-500">{errors.post_content}</p>}
            </div>

            {hasAuthorDetails && (
              <div className="rounded-2xl border border-accent-aqua/60 bg-white/70 px-4 py-3 shadow-inner">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">Author</p>
                <div className="mt-1 flex flex-col gap-1 text-sm">
                  {state.authorName && <p className="font-heading text-base font-semibold text-text">{state.authorName}</p>}
                  {state.authorHeadline && <p className="text-text/70">{state.authorHeadline}</p>}
                  {state.authorCompany && <p className="text-xs text-text/60">{state.authorCompany}</p>}
                  {state.authorUrl && (
                    <a
                      className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary hover:text-accent-teal"
                      href={state.authorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View profile
                    </a>
                  )}
                </div>
              </div>
            )}

            {state.highlight && (
              <div className="space-y-2">
                <Label>Highlight</Label>
                <Textarea value={state.highlight} readOnly className="min-h-[96px] bg-accent-aqua/30" />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={state.notes}
                onChange={(event) => withState("notes")(event.target.value)}
                aria-invalid={Boolean(errors.notes)}
              />
              {errors.notes && <p className="text-xs text-red-500">{errors.notes}</p>}
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-accent-aqua/60 bg-white/70 px-4 py-3 shadow-inner">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-text">Add AI summary &amp; tags</span>
                <span className="text-xs text-text/60">Create ready-to-use insights automatically.</span>
              </div>
              <button
                type="button"
                className={cn(
                  "relative inline-flex h-6 w-12 items-center rounded-full border border-accent-aqua/80 bg-white shadow-inner transition",
                  state.aiEnabled ? "bg-primary/90" : "bg-white"
                )}
                onClick={() => handleAiToggle(!state.aiEnabled)}
                aria-pressed={state.aiEnabled}
              >
                <span
                  className={cn(
                    "block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    state.aiEnabled ? "translate-x-[22px]" : "translate-x-[2px]"
                  )}
                />
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <div className="relative">
                <select
                  id="status"
                  value={state.status}
                  onChange={(event) => handleStatusChange(event.target.value)}
                  aria-invalid={Boolean(errors.status)}
                  className="h-11 w-full appearance-none rounded-xl border border-accent-aqua/80 bg-white/80 px-4 text-sm font-medium text-text shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-text/50">▾</span>
              </div>
              {errors.status && <p className="text-xs text-red-500">{errors.status}</p>}
            </div>

            <Button className="w-full" size="lg" onClick={() => handleSubmit()} disabled={saving}>
              {saving ? "Saving…" : "Save to sheet"}
            </Button>

            {duplicatePost && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4 text-xs text-amber-900">
                <p className="font-semibold">Already saved</p>
                <p className="mt-1 break-words text-amber-900/80">
                  Saved on {new Date(duplicatePost.savedAt).toLocaleString()} with status “{duplicatePost.status}”.
                </p>
              </div>
            )}

            {message && (
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-xs shadow-sm",
                  message.variant === "success"
                    ? "border-emerald-400/70 bg-emerald-50 text-emerald-900"
                    : message.variant === "warning"
                      ? "border-amber-400/70 bg-amber-50 text-amber-900"
                      : "border-red-400/70 bg-red-50 text-red-900"
                )}
              >
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-[2px] h-4 w-4" />
                  <div className="flex flex-1 flex-col gap-2">
                    <span>{message.text}</span>
                    {message.actions && message.actions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                          <Button
                            key={action}
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-full border border-current px-3 text-xs font-semibold"
                            onClick={() => handleMessageAction(action)}
                          >
                            {actionLabel(action)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(2,115,115,0.18),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-y-0 right-6 -z-10 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
    </div>
  );
}
