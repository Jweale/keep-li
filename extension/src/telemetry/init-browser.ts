import * as Sentry from "@sentry/browser";
import { config } from "../config";
import { isTelemetryEnabled, onTelemetryPreferenceChange } from "./preferences";

let initialized = false;

type InitOptions = {
  context?: string;
};

export const initBrowserSentry = (options: InitOptions = {}) => {
  const dsn = config.telemetry.sentryDsn;
  if (!dsn) {
    return null;
  }

  if (!initialized) {
    Sentry.init({
      dsn,
      environment: config.environment,
      release: config.telemetry.release,
      tracesSampleRate: config.telemetry.tracesSampleRate,
      sendClientReports: false,
      beforeSend(event) {
        return isTelemetryEnabled() ? event : null;
      }
    });
    initialized = true;
    Sentry.setTag("telemetry_opt_in", String(isTelemetryEnabled()));
    onTelemetryPreferenceChange((enabled) => {
      Sentry.setTag("telemetry_opt_in", String(enabled));
    });
  }

  if (options.context) {
    Sentry.setTag("extension_context", options.context);
  }

  return Sentry;
};
