import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FEATURE_FLAGS,
  LIMITED_USE_POLICY_URL,
  PRIVACY_POLICY_URL,
  storageKey,
  type FeatureFlags
} from "@keep-li/shared";
import { ArrowUpRight, CheckCircle2, CircleDashed } from "lucide-react";

import { config } from "../config";
import { createLogger } from "../telemetry/logger";
import { setTelemetryEnabled as persistTelemetryEnabled } from "../telemetry/preferences";
import { resolveAsset } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SHEET_ID_KEY = storageKey("SHEET_ID", STORAGE_CONTEXT);
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const FEATURE_FLAGS_KEY = storageKey("FEATURE_FLAGS", STORAGE_CONTEXT);
const TELEMETRY_ENABLED_KEY = storageKey("TELEMETRY_ENABLED", STORAGE_CONTEXT);
const logger = createLogger({ component: "onboarding" });

const toErrorMetadata = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined
});

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
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const stored = await chrome.storage.local.get([
          SHEET_ID_KEY,
          LICENSE_KEY_KEY,
          ONBOARDING_COMPLETE_KEY,
          FEATURE_FLAGS_KEY,
          TELEMETRY_ENABLED_KEY
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

        const storedTelemetry = stored[TELEMETRY_ENABLED_KEY];
        if (typeof storedTelemetry === "boolean") {
          setTelemetryEnabled(storedTelemetry);
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
          signal: controller.signal
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
          logger.warn("onboarding.persist_feature_flags_failed", {
            error: toErrorMetadata(error)
          });
        }
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!controller.signal.aborted) {
          logger.warn("onboarding.feature_flags_fetch_failed", { message });
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
          Authorization: `Bearer ${token}`
        }
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

  const handleTelemetryChange = useCallback((value: boolean) => {
    setTelemetryEnabled(value);
    void persistTelemetryEnabled(value);
  }, [persistTelemetryEnabled]);

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
        [ONBOARDING_COMPLETE_KEY]: true
      };
      if (trimmedLicense) {
        updates[LICENSE_KEY_KEY] = trimmedLicense;
      }

      await chrome.storage.local.set(updates);
      await persistTelemetryEnabled(telemetryEnabled);

      if (!trimmedLicense) {
        try {
          await chrome.storage.local.remove(LICENSE_KEY_KEY);
        } catch (error) {
          logger.warn("onboarding.clear_license_failed", {
            error: toErrorMetadata(error)
          });
        }
      }

      setOnboardingComplete(true);
      setSaveMessage({ variant: "success", text: "Onboarding details saved." });
    } catch (error) {
      logger.error("onboarding.store_state_failed", {
        error: toErrorMetadata(error)
      });
      setSaveMessage({ variant: "error", text: "Saving failed. Retry in a moment." });
    } finally {
      setSaving(false);
    }
  }, [licenseKey, sheetId, telemetryEnabled]);

  const sheetUrl = useMemo(() => {
    const trimmed = sheetId.trim();
    return trimmed ? `https://docs.google.com/spreadsheets/d/${trimmed}` : null;
  }, [sheetId]);

  const logoUrl = useMemo(() => resolveAsset("branding/keep-li_logo.png"), []);
  const logoIconUrl = useMemo(() => resolveAsset("branding/keep-li_logo_icon.png"), []);

  const bannerClass = (variant: "success" | "error") =>
    cn(
      "rounded-2xl border px-4 py-3 text-xs",
      variant === "success"
        ? "border-emerald-400/70 bg-emerald-50 text-emerald-800"
        : "border-amber-400/70 bg-amber-50 text-amber-800"
    );

  return (
    <main className="relative min-h-screen bg-gradient-to-br from-[#F2E7DC] via-[#f8f4ee] to-white px-6 py-10 text-text">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(2,115,115,0.16),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-y-0 right-12 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="glass-card flex flex-col gap-4 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <img src={logoIconUrl} alt="Keep-li icon" className="h-12 w-12 rounded-2xl border border-primary/20" />
              <div className="flex flex-col">
                <h1 className="font-heading text-2xl font-semibold">Welcome to Keep-li</h1>
                <p className="text-sm text-text/70">Connect your Google Sheet and unlock AI-powered saves in seconds.</p>
              </div>
            </div>
            <img src={logoUrl} alt="Keep-li" className="hidden h-9 md:block" />
          </div>
          {onboardingComplete && (
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/70 bg-emerald-50/80 px-3 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> Onboarding complete
            </div>
          )}
        </header>

        {initializing ? (
          <Card className="border-dashed border-primary/30 bg-white/80 p-4 text-sm text-text/70">
            Loading saved data…
          </Card>
        ) : initialError ? (
          <Card className="border border-amber-300 bg-amber-50/90 p-4 text-sm text-amber-900">{initialError}</Card>
        ) : null}

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Feature flags</CardTitle>
            <CardDescription>We’ll keep these in sync so your extension stays aligned with releases.</CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">Managed AI</p>
                <p className="mt-1 text-sm font-medium text-text">{flags.managedAi ? "Enabled" : "Disabled"}</p>
              </div>
              <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">Bring your own key</p>
                <p className="mt-1 text-sm font-medium text-text">{flags.byoKeyMode ? "Enabled" : "Disabled"}</p>
              </div>
            </div>
            {flagsLoading && <p className="text-xs text-text/60">Refreshing latest flags…</p>}
            {flagsError && <p className="text-xs text-amber-600">{flagsError}</p>}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Connect Google Sheets</CardTitle>
            <CardDescription>Paste the ID of the sheet that stores your saved LinkedIn posts.</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-text/80">Google Sheet ID</label>
              <Input
                value={sheetId}
                onChange={(event) => setSheetId(event.target.value)}
                placeholder="e.g. 1A2B3C…"
                spellCheck={false}
                disabled={initializing || saving}
              />
              {sheetUrl && (
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent-teal"
                  href={sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" /> Open sheet
                </a>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-text/80">License key (optional)</label>
              <Input
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder="Paste your license key"
                spellCheck={false}
                disabled={saving}
              />
            </div>

            <div className="rounded-2xl border border-accent-aqua/70 bg-white/70 px-4 py-4 shadow-inner">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">Verify Google Sheets access</p>
                  <p className="text-xs text-text/60">We’ll request a token from Google and confirm the sheet exists.</p>
                </div>
                <Button onClick={() => void handleConnectionTest()} disabled={connectionState === "pending" || saving}>
                  {connectionState === "pending" ? "Checking…" : "Test connection"}
                </Button>
              </div>
              {connectionMessage && (
                <p
                  className={cn(
                    "mt-3 text-xs",
                    connectionState === "success"
                      ? "text-emerald-700"
                      : connectionState === "pending"
                        ? "text-text/60"
                        : "text-amber-700"
                  )}
                >
                  {connectionMessage}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Privacy & telemetry</CardTitle>
            <CardDescription>Control what we collect and review how we use your data.</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-4 shadow-sm">
              <label className="flex items-start gap-3 text-sm text-text/80">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border border-primary/40"
                  checked={telemetryEnabled}
                  onChange={(event) => handleTelemetryChange(event.target.checked)}
                />
                <span>
                  Share anonymised crash reports and error diagnostics to help us keep Keep-li reliable. This never
                  includes sheet contents.
                </span>
              </label>
            </div>
            <div className="space-y-2 text-xs text-text/70">
              <p>
                We access your Google Sheet only to append rows you choose and retain local post history for 90 days
                before automatic deletion.
              </p>
              <p>
                Read our{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Policy
                </a>{" "}and{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={LIMITED_USE_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Sheets limited-use statement
                </a>{" "}
                to learn more.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Finish setup</CardTitle>
            <CardDescription>Save these details so the capture panel can start using them immediately.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <Button className="w-full" size="lg" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Saving…" : "Save and continue"}
            </Button>
            {saveMessage && <div className={bannerClass(saveMessage.variant)}>{saveMessage.text}</div>}
          </CardContent>
        </Card>

        <footer className="mt-4 flex items-center gap-2 text-xs text-text/60">
          <CircleDashed className="h-3.5 w-3.5" /> Your data, your sheet. We keep it yours.
        </footer>
      </div>
    </main>
  );
};

export default App;
