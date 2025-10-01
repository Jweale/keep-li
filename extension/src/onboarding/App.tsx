import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_FEATURE_FLAGS, storageKey, type FeatureFlags } from "@keep-li/shared";

import { config } from "../config";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SHEET_ID_KEY = storageKey("SHEET_ID", STORAGE_CONTEXT);
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const FEATURE_FLAGS_KEY = storageKey("FEATURE_FLAGS", STORAGE_CONTEXT);

type ConnectionState = "idle" | "pending" | "success" | "error";

const isFeatureFlags = (value: unknown): value is FeatureFlags => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.managedAi === "boolean" && typeof candidate.byoKeyMode === "boolean";
};

const App = () => {
  const [sheetId, setSheetId] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ variant: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await chrome.storage.local.get([
          SHEET_ID_KEY,
          LICENSE_KEY_KEY,
          ONBOARDING_COMPLETE_KEY,
          FEATURE_FLAGS_KEY,
        ]);
        if (!active) {
          return;
        }
        const storedSheetId = stored[SHEET_ID_KEY];
        if (typeof storedSheetId === "string") {
          setSheetId(storedSheetId);
        }
        const storedLicenseKey = stored[LICENSE_KEY_KEY];
        if (typeof storedLicenseKey === "string") {
          setLicenseKey(storedLicenseKey);
        }
        const storedOnboarding = stored[ONBOARDING_COMPLETE_KEY];
        if (typeof storedOnboarding === "boolean") {
          setOnboardingComplete(storedOnboarding);
        }
        const storedFlags = stored[FEATURE_FLAGS_KEY];
        if (isFeatureFlags(storedFlags)) {
          setFlags(storedFlags);
        }
      } catch (error) {
        if (active) {
          setInitialError("Unable to load saved onboarding data.");
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      setFlagsLoading(true);
      try {
        const response = await fetch(`${config.apiEndpoint}/v1/flags`, {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`flags_request_failed:${response.status}`);
        }
        const data = (await response.json()) as { flags?: unknown };
        const resolved = isFeatureFlags(data.flags) ? data.flags : DEFAULT_FEATURE_FLAGS;
        if (!active) {
          return;
        }
        setFlags(resolved);
        setFlagsError(null);
        try {
          await chrome.storage.local.set({ [FEATURE_FLAGS_KEY]: resolved });
        } catch (error) {
          console.warn("Failed to persist feature flags", error);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!controller.signal.aborted) {
          console.warn("Feature flags fetch failed", message);
          setFlags(DEFAULT_FEATURE_FLAGS);
          setFlagsError("Feature flags unavailable. Using defaults.");
        }
      } finally {
        if (active) {
          setFlagsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const acquireAuthToken = useCallback(
    (interactive: boolean) =>
      new Promise<string>((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          const resolved = typeof token === "string" ? token : token?.token;
          if (!resolved) {
            reject(new Error("empty_token"));
            return;
          }
          resolve(resolved);
        });
      }),
    []
  );

  const removeCachedToken = useCallback(
    (token: string) =>
      new Promise<void>((resolve, reject) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      }),
    []
  );

  const handleConnectionTest = useCallback(async () => {
    const trimmedSheetId = sheetId.trim();
    if (!trimmedSheetId) {
      setConnectionState("error");
      setConnectionMessage("Enter your Google Sheet ID before testing.");
      return;
    }

    setConnectionState("pending");
    setConnectionMessage("Requesting access to Google Sheets...");

    try {
      const token = await acquireAuthToken(true);
      const response = await fetch(`${config.sheetsApiEndpoint}/${trimmedSheetId}?fields=spreadsheetId`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        await removeCachedToken(token).catch(() => {});
        throw new Error("unauthorized");
      }

      if (response.status === 404) {
        throw new Error("sheet_not_found");
      }

      if (!response.ok) {
        throw new Error("sheet_check_failed");
      }

      setConnectionState("success");
      setConnectionMessage("Google Sheets connection verified.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let friendly = "Could not verify Google Sheets access.";
      if (message === "sheet_not_found") {
        friendly = "Sheet not found. Double-check the ID.";
      } else if (message === "unauthorized") {
        friendly = "Authorization failed. Try again after reconnecting.";
      } else if (message === "empty_token") {
        friendly = "Google did not return an access token. Retry in a moment.";
      }
      setConnectionState("error");
      setConnectionMessage(friendly);
    }
  }, [acquireAuthToken, removeCachedToken, sheetId]);

  const handleSubmit = useCallback(async () => {
    const trimmedSheetId = sheetId.trim();
    const trimmedLicense = licenseKey.trim();

    if (!trimmedSheetId) {
      setSaveMessage({ variant: "error", text: "Enter your Google Sheet ID." });
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const updates: Record<string, unknown> = {
        [SHEET_ID_KEY]: trimmedSheetId,
        [ONBOARDING_COMPLETE_KEY]: true,
      };
      if (trimmedLicense) {
        updates[LICENSE_KEY_KEY] = trimmedLicense;
      }

      await chrome.storage.local.set(updates);

      if (!trimmedLicense) {
        try {
          await chrome.storage.local.remove(LICENSE_KEY_KEY);
        } catch (error) {
          console.warn("Failed to clear license key", error);
        }
      }

      setOnboardingComplete(true);
      setSaveMessage({ variant: "success", text: "Onboarding details saved." });
    } catch (error) {
      console.error("Failed to store onboarding state", error);
      setSaveMessage({ variant: "error", text: "Saving failed. Retry in a moment." });
    } finally {
      setSaving(false);
    }
  }, [licenseKey, sheetId]);

  const sheetUrl = useMemo(() => {
    const trimmed = sheetId.trim();
    return trimmed ? `https://docs.google.com/spreadsheets/d/${trimmed}` : null;
  }, [sheetId]);

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Welcome to Keep-li</h1>
          <p className="text-sm text-slate-300">A quick setup to connect your Google Sheet and optional license key.</p>
          {onboardingComplete && (
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100">
              Onboarding complete
            </span>
          )}
        </header>

        {initializing ? (
          <div className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
            Loading saved data...
          </div>
        ) : initialError ? (
          <div className="rounded border border-amber-600 bg-amber-500/10 p-4 text-sm text-amber-100">
            {initialError}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Feature flags</h2>
            {flagsLoading && <span className="text-xs text-slate-400">Refreshing…</span>}
          </div>
          <ul className="flex flex-col gap-2 text-sm text-slate-200">
            <li className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-2">
              <span>Managed AI</span>
              <span className={flags.managedAi ? "text-emerald-300" : "text-amber-300"}>
                {flags.managedAi ? "Enabled" : "Disabled"}
              </span>
            </li>
            <li className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-2">
              <span>Bring-your-own key</span>
              <span className={flags.byoKeyMode ? "text-emerald-300" : "text-amber-300"}>
                {flags.byoKeyMode ? "Enabled" : "Disabled"}
              </span>
            </li>
          </ul>
          {flagsError && <p className="mt-3 text-xs text-amber-300">{flagsError}</p>}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-medium">Connect Google Sheets</h2>
          <p className="mt-1 text-sm text-slate-300">
            Paste the ID of the Google Sheet you created for Keep-li.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-200">Google Sheet ID</span>
              <input
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={sheetId}
                onChange={(event) => setSheetId(event.target.value)}
                placeholder="e.g. 1A2B3C..."
                spellCheck={false}
                disabled={initializing || saving}
              />
              {sheetUrl && (
                <a
                  className="text-xs font-medium text-primary underline-offset-4 hover:text-accent-teal"
                  href={sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open sheet
                </a>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-200">License key (optional)</span>
              <input
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder="Paste your license key"
                spellCheck={false}
                disabled={saving}
              />
            </label>

            <div className="flex flex-col gap-2 text-sm">
              <button
                className="inline-flex w-fit items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-accent-teal disabled:opacity-60"
                onClick={() => void handleConnectionTest()}
                disabled={connectionState === "pending" || saving}
              >
                {connectionState === "pending" ? "Checking…" : "Test Google Sheets connection"}
              </button>
              {connectionMessage && (
                <span
                  className={
                    connectionState === "success"
                      ? "text-xs text-emerald-300"
                      : connectionState === "pending"
                        ? "text-xs text-slate-300"
                        : "text-xs text-amber-300"
                  }
                >
                  {connectionMessage}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-medium">Finish setup</h2>
          <p className="mt-1 text-sm text-slate-300">Save these details so the capture panel can use them.</p>
          <div className="mt-4 flex flex-col gap-3">
            <button
              className="w-full rounded bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-teal disabled:opacity-60"
              onClick={() => void handleSubmit()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save and continue"}
            </button>
            {saveMessage && (
              <div
                className={
                  saveMessage.variant === "success"
                    ? "rounded border border-emerald-600 bg-emerald-500/10 p-3 text-xs text-emerald-200"
                    : "rounded border border-amber-600 bg-amber-500/10 p-3 text-xs text-amber-100"
                }
              >
                {saveMessage.text}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

export default App;
