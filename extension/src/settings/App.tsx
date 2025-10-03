import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { PRIVACY_POLICY_URL, STORAGE_NAMESPACE, storageKey } from "@keep-li/shared";
import { Download, Upload } from "lucide-react";

import { config } from "../config";
import { setTelemetryEnabled as persistTelemetryEnabled } from "../telemetry/preferences";
import { createLogger } from "../telemetry/logger";
import { resolveAsset } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const LAST_STATUS_KEY = storageKey("LAST_STATUS", STORAGE_CONTEXT);
const AI_ENABLED_KEY = storageKey("AI_ENABLED", STORAGE_CONTEXT);
const FEATURE_FLAGS_KEY = storageKey("FEATURE_FLAGS", STORAGE_CONTEXT);
const TELEMETRY_ENABLED_KEY = storageKey("TELEMETRY_ENABLED", STORAGE_CONTEXT);
const logger = createLogger({ component: "settings", environment: config.environment });

type Banner = { variant: "success" | "error" | "info"; text: string } | null;
const storageKeys = [
  LICENSE_KEY_KEY,
  ONBOARDING_COMPLETE_KEY,
  LAST_STATUS_KEY,
  AI_ENABLED_KEY,
  FEATURE_FLAGS_KEY,
  TELEMETRY_ENABLED_KEY
];

const buildFileName = () => {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  return `keep-li-settings-${iso}.json`;
};

const storageGet = async <T,>(keys: string[] | null): Promise<Record<string, T>> =>
  await new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result as Record<string, T>);
    });
  });

const storageSet = async (entries: Record<string, unknown>) =>
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const storageRemove = async (keys: string | string[]) =>
  await new Promise<void>((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const filterNamespace = (source: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(source).filter(([key]) => typeof key === "string" && key.startsWith(STORAGE_NAMESPACE))
  );

const App = () => {
  const [initialising, setInitialising] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<Banner>(null);
  const [exporting, setExporting] = useState(false);
  const [exportBanner, setExportBanner] = useState<Banner>(null);
  const [importing, setImporting] = useState(false);
  const [importBanner, setImportBanner] = useState<Banner>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [telemetryUpdating, setTelemetryUpdating] = useState(false);
  const [telemetryBanner, setTelemetryBanner] = useState<Banner>(null);
  const [sessionBanner, setSessionBanner] = useState<Banner>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setInitialising(true);
    setLoadError(null);
    try {
      const stored = await storageGet<string | boolean | Record<string, unknown>>(storageKeys);
      const nextLicense = stored[LICENSE_KEY_KEY];
      setLicenseKey(typeof nextLicense === "string" ? nextLicense : "");
      const nextTelemetry = stored[TELEMETRY_ENABLED_KEY];
      setTelemetryEnabled(typeof nextTelemetry === "boolean" ? nextTelemetry : true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
    } finally {
      setInitialising(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async () => {
    setSaveBanner(null);
    const trimmedLicense = licenseKey.trim();

    setSaving(true);
    try {
      if (trimmedLicense) {
        await storageSet({ [LICENSE_KEY_KEY]: trimmedLicense });
      } else {
        await storageRemove(LICENSE_KEY_KEY);
      }
      setSaveBanner({ variant: "success", text: "Settings saved." });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveBanner({ variant: "error", text: `Save failed: ${message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSupabaseSignOut = async () => {
    setSessionBanner(null);
    try {
      const response = await new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "supabase-session:clear" }, (result) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message ?? "message_failed"));
            return;
          }
          resolve(result as { ok?: boolean; error?: string });
        });
      });

      if (!response?.ok) {
        throw new Error(response?.error ?? "unknown_error");
      }

      setSessionBanner({ variant: "success", text: "Supabase session cleared." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionBanner({ variant: "error", text: `Sign out failed: ${message}` });
    }
  };

  const logoUrl = useMemo(() => resolveAsset("branding/keep-li_logo.png"), []);
  const logoIconUrl = useMemo(() => resolveAsset("branding/keep-li_logo_icon.png"), []);

  const handleExport = async () => {
    setExportBanner(null);
    setExporting(true);
    try {
      const all = await storageGet<unknown>(null);
      const filtered = filterNamespace(all);
      const payload = {
        version: 1,
        environment: config.environment,
        data: filtered
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildFileName();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportBanner({ variant: "success", text: "Settings exported." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportBanner({ variant: "error", text: `Export failed: ${message}` });
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setImportBanner(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid file structure");
      }
      const data = (parsed as { data?: unknown }).data;
      if (!data || typeof data !== "object") {
        throw new Error("Missing data section");
      }
      const entries = Object.entries(data as Record<string, unknown>);
      const filtered = Object.fromEntries(entries.filter(([key]) => key.startsWith(STORAGE_NAMESPACE)));
      if (Object.keys(filtered).length === 0) {
        throw new Error("No Keep-li settings found");
      }
      await storageSet(filtered);
      setImportBanner({ variant: "success", text: "Settings imported." });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportBanner({ variant: "error", text: `Import failed: ${message}` });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleTelemetryToggle = useCallback(async (value: boolean) => {
    setTelemetryBanner(null);
    setTelemetryUpdating(true);
    setTelemetryEnabled(value);
    try {
      await persistTelemetryEnabled(value);
      setTelemetryBanner({
        variant: "success",
        text: value
          ? "Telemetry enabled. Thanks for helping us improve reliability."
          : "Telemetry disabled. We will stop sending anonymised diagnostics."
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTelemetryEnabled(!value);
      setTelemetryBanner({ variant: "error", text: `Unable to update telemetry preference: ${message}` });
    } finally {
      setTelemetryUpdating(false);
    }
  }, [persistTelemetryEnabled]);

  const bannerClass = (variant: NonNullable<Banner>["variant"]) =>
    cn(
      "rounded-2xl border px-4 py-3 text-xs shadow-sm",
      variant === "success"
        ? "border-emerald-400/70 bg-emerald-50 text-emerald-800"
        : variant === "info"
          ? "border-slate-400/70 bg-white/80 text-text/80"
          : "border-amber-400/70 bg-amber-50 text-amber-800"
    );

  const keyboardShortcuts = [
    {
      id: "open-panel",
      title: "Open capture panel",
      description: "Launch the capture UI from LinkedIn or any active tab with Keep-li enabled.",
      mac: "Cmd + Shift + S",
      windows: "Ctrl + Shift + S"
    },
    {
      id: "save-capture",
      title: "Save current capture",
      description: "Triggers the save action without leaving the keyboard.",
      mac: "Cmd + Enter",
      windows: "Ctrl + Enter"
    }
  ] as const;
  const shortcutBadgeClass =
    "rounded-md border border-text/10 bg-white/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-text/80 shadow-sm";

  return (
    <main className="relative min-h-screen bg-gradient-to-br from-[#F2E7DC] via-[#f8f4ee] to-white px-6 py-10 text-text">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(2,115,115,0.18),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-y-0 right-16 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="glass-card flex flex-col gap-4 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <img src={logoIconUrl} alt="Keep-li icon" className="h-12 w-12 rounded-2xl border border-primary/20" />
              <div className="flex flex-col">
                <h1 className="font-heading text-2xl font-semibold">Keep-li settings</h1>
                <p className="text-sm text-text/70">Manage your Keep-li account, licensing, and local preferences.</p>
              </div>
            </div>
            <img src={logoUrl} alt="Keep-li" className="hidden h-9 md:block" />
          </div>
        </header>

        {initialising ? (
          <Card className="border-dashed border-primary/30 bg-white/85 p-4 text-sm text-text/70">Loading settings…</Card>
        ) : loadError ? (
          <Card className="border border-amber-300 bg-amber-50/90 p-4 text-sm text-amber-800">
            Failed to load settings: {loadError}
          </Card>
        ) : null}

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Manage your license key and local extension settings.</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-text/80">License key (optional)</label>
              <Input
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                placeholder="Paste your Keep-li license key"
                spellCheck={false}
                disabled={saving}
              />
            </div>

            <div className="rounded-2xl border border-accent-aqua/70 bg-white/70 px-4 py-4 text-xs text-text/70 shadow-inner">
              Keep-li stores your saved posts in Supabase. License keys unlock additional features but are optional.
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>

            {saveBanner && <div className={bannerClass(saveBanner.variant)}>{saveBanner.text}</div>}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Keep-li session</CardTitle>
            <CardDescription>Manage the Supabase session tokens stored by this extension.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-4 text-xs text-text/70 shadow-inner">
              Use the capture panel to sign in with Keep-li. If you need to disconnect this browser, clear the stored
              session below.
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => void handleSupabaseSignOut()}>
                Sign out of Keep-li
              </Button>
            </div>
            {sessionBanner && <div className={bannerClass(sessionBanner.variant)}>{sessionBanner.text}</div>}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Privacy & telemetry</CardTitle>
            <CardDescription>Manage diagnostics sharing and review how we handle your data.</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-4 shadow-sm">
              <label className="flex items-start gap-3 text-sm text-text/80">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border border-primary/40"
                  checked={telemetryEnabled}
                  disabled={telemetryUpdating}
                  onChange={(event) => void handleTelemetryToggle(event.target.checked)}
                />
                <span>
                  Share anonymised crash reports and error diagnostics to help us keep Keep-li reliable. We never collect
                  Supabase data or saved content.
                </span>
              </label>
            </div>
            <div className="space-y-2 text-xs text-text/70">
              <p>We sync saves to Supabase and trim local post history after 90 days or 50 items, whichever comes first.</p>
              <p>
                Read our{" "}
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Policy
                </a>{" "}for full details.
              </p>
            </div>
            {telemetryBanner && <div className={bannerClass(telemetryBanner.variant)}>{telemetryBanner.text}</div>}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Keyboard shortcuts</CardTitle>
            <CardDescription>Work faster with quick actions for capture and saving.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="space-y-4 text-sm">
              {keyboardShortcuts.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex flex-col gap-3 rounded-2xl border border-accent-aqua/60 bg-white/80 px-4 py-4 shadow-inner sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="sm:max-w-[60%]">
                    <p className="font-semibold text-text">{shortcut.title}</p>
                    <p className="text-xs text-text/60">{shortcut.description}</p>
                  </div>
                  <div className="flex flex-col items-start gap-2 text-xs text-text/70 sm:items-end">
                    <span>
                      <span className="text-text font-semibold">Mac:</span>{" "}
                      <span className={shortcutBadgeClass}>{shortcut.mac}</span>
                    </span>
                    <span>
                      <span className="text-text font-semibold">Windows:</span>{" "}
                      <span className={shortcutBadgeClass}>{shortcut.windows}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Backup</CardTitle>
            <CardDescription>Export your Keep-li settings or restore them from a previous backup.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleExport()} disabled={exporting}>
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "Preparing…" : "Export settings"}
              </Button>
              <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                <Upload className="mr-2 h-4 w-4" /> Import settings
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => void handleImport(event)}
              />
            </div>
            {(exportBanner || importBanner) && (
              <div className="flex flex-col gap-2">
                {exportBanner && <div className={bannerClass(exportBanner.variant)}>{exportBanner.text}</div>}
                {importBanner && <div className={bannerClass(importBanner.variant)}>{importBanner.text}</div>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default App;
