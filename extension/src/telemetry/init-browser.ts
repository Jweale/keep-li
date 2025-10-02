import * as Sentry from "@sentry/browser";
import { config } from "../config";

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
      sendClientReports: false
    });
    initialized = true;
  }

  if (options.context) {
    Sentry.setTag("extension_context", options.context);
  }

  return Sentry;
};
