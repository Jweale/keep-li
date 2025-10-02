import * as Sentry from "@sentry/react";
import { config } from "../config";
import { isTelemetryEnabled, onTelemetryPreferenceChange } from "./preferences";

let initialized = false;

export const initReactSentry = () => {
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
    Sentry.setTag("extension_context", "ui");
    Sentry.setTag("telemetry_opt_in", String(isTelemetryEnabled()));
    onTelemetryPreferenceChange((enabled) => {
      Sentry.setTag("telemetry_opt_in", String(enabled));
    });
    initialized = true;
  }

  return Sentry;
};
