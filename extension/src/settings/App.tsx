import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { STORAGE_NAMESPACE, storageKey } from "@keep-li/shared";
import { ArrowUpRight, Download, RefreshCw, Upload } from "lucide-react";

import { config } from "../config";
import { createLogger } from "../telemetry/logger";
import { resolveAsset } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STORAGE_CONTEXT = { environment: config.environment } as const;
const SHEET_ID_KEY = storageKey("SHEET_ID", STORAGE_CONTEXT);
const LICENSE_KEY_KEY = storageKey("LICENSE_KEY", STORAGE_CONTEXT);
const ONBOARDING_COMPLETE_KEY = storageKey("ONBOARDING_COMPLETE", STORAGE_CONTEXT);
const LAST_STATUS_KEY = storageKey("LAST_STATUS", STORAGE_CONTEXT);
const AI_ENABLED_KEY = storageKey("AI_ENABLED", STORAGE_CONTEXT);
const FEATURE_FLAGS_KEY = storageKey("FEATURE_FLAGS", STORAGE_CONTEXT);
const logger = createLogger({ component: "settings", environment: config.environment });

type Banner = { variant: "success" | "error" | "info"; text: string } | null;
type ReconnectState = "idle" | "pending" | "success" | "error";

const storageKeys = [
  SHEET_ID_KEY,
  LICENSE_KEY_KEY,
  ONBOARDING_COMPLETE_KEY,
  LAST_STATUS_KEY,
  AI_ENABLED_KEY,
  FEATURE_FLAGS_KEY
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

const getAuthToken = async (interactive: boolean) =>
  await new Promise<string>((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      const value = typeof token === "string" ? token : token?.token;
      if (!value) {
        reject(new Error("empty_token"));
        return;
      }
      resolve(value);
    });
  });

const removeCachedToken = async (token: string) =>
  await new Promise<void>((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
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
  const [sheetId, setSheetId] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveBanner, setSaveBanner] = useState<Banner>(null);
  const [reconnectState, setReconnectState] = useState<ReconnectState>("idle");
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportBanner, setExportBanner] = useState<Banner>(null);
  const [importing, setImporting] = useState(false);
  const [importBanner, setImportBanner] = useState<Banner>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setInitialising(true);
    setLoadError(null);
    try {
      const stored = await storageGet<string | boolean | Record<string, unknown>>(storageKeys);
      const nextSheet = stored[SHEET_ID_KEY];
      const nextLicense = stored[LICENSE_KEY_KEY];
      setSheetId(typeof nextSheet === "string" ? nextSheet : "");
      setLicenseKey(typeof nextLicense === "string" ? nextLicense : "");
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
    const trimmedSheet = sheetId.trim();
    const trimmedLicense = licenseKey.trim();

    if (!trimmedSheet) {
      setSaveBanner({ variant: "error", text: "Enter your Google Sheet ID." });
      return;
    }

    setSaving(true);
    try {
      await storageSet({ [SHEET_ID_KEY]: trimmedSheet });
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

  const handleOpenSheet = async () => {
    const trimmed = sheetId.trim();
    if (!trimmed) {
      setSaveBanner({ variant: "error", text: "Add a Google Sheet ID first." });
      return;
    }
    const url = `https://docs.google.com/spreadsheets/d/${trimmed}`;
    try {
      await chrome.tabs.create({ url });
      setSaveBanner({ variant: "info", text: "Sheet opened in a new tab." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveBanner({ variant: "error", text: `Unable to open sheet: ${message}` });
    }
  };

  const handleReconnect = useCallback(async () => {
    setReconnectState("pending");
    setReconnectMessage("Preparing Google authorization...");
    try {
      try {
        const cached = await getAuthToken(false);
        if (cached) {
          await removeCachedToken(cached);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "empty_token") {
          logger.warn("settings.token_removal_skipped", { message });
        }
      }

      await getAuthToken(true);
      setReconnectState("success");
      setReconnectMessage("Google account reconnected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReconnectState("error");
      setReconnectMessage(`Reconnect failed: ${message}`);
    }
  }, []);
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

  const sheetUrl = sheetId.trim() ? `https://docs.google.com/spreadsheets/d/${sheetId.trim()}` : null;

  const bannerClass = (variant: NonNullable<Banner>["variant"]) =>
    cn(
      "rounded-2xl border px-4 py-3 text-xs shadow-sm",
      variant === "success"
        ? "border-emerald-400/70 bg-emerald-50 text-emerald-800"
        : variant === "info"
          ? "border-slate-400/70 bg-white/80 text-text/80"
          : "border-amber-400/70 bg-amber-50 text-amber-800"
    );

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
                <p className="text-sm text-text/70">Manage your sheet connection, licensing, and local preferences.</p>
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
            <CardTitle>Storage</CardTitle>
            <CardDescription>Control the Google Sheet and optional license key used by the extension.</CardDescription>
          </CardHeader>
          <CardContent className="gap-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-text/80">Google Sheet ID</label>
              <Input
                value={sheetId}
                onChange={(event) => setSheetId(event.target.value)}
                spellCheck={false}
                disabled={initialising || saving}
              />
              {sheetUrl && (
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent-teal"
                  href={sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" /> Preview sheet
                </a>
              )}
            </div>

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

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
              <Button variant="outline" onClick={() => void handleOpenSheet()} disabled={saving}>
                Open my sheet
              </Button>
            </div>

            {saveBanner && <div className={bannerClass(saveBanner.variant)}>{saveBanner.text}</div>}
          </CardContent>
        </Card>

        <Card className="p-6">
          <CardHeader className="gap-2">
            <CardTitle>Google account</CardTitle>
            <CardDescription>Re-authorise access if Sheets calls begin to fail.</CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="rounded-2xl border border-accent-aqua/70 bg-white/80 px-4 py-4 shadow-inner">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">Reconnect Google Account</p>
                  <p className="text-xs text-text/60">We’ll request a fresh OAuth token and clear any cached failures.</p>
                </div>
                <Button onClick={handleReconnect} disabled={reconnectState === "pending"}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {reconnectState === "pending" ? "Requesting…" : "Reconnect"}
                </Button>
              </div>
              {reconnectMessage && (
                <p
                  className={cn(
                    "mt-3 text-xs",
                    reconnectState === "success"
                      ? "text-emerald-700"
                      : reconnectState === "pending"
                        ? "text-text/60"
                        : "text-amber-700"
                  )}
                >
                  {reconnectMessage}
                </p>
              )}
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
