import * as Sentry from "@sentry/react";
import { config } from "../config";

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
      sendClientReports: false
    });
    Sentry.setTag("extension_context", "ui");
    initialized = true;
  }

  return Sentry;
};
