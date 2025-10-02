# Chrome Web Store Privacy Disclosures

## Privacy Policy URL

https://keep-li.app/privacy

## Data Collection and Usage

- **User-provided content**: Links, highlights, and notes selected by the user are sent to the user’s own Google Sheet only when they explicitly save a post. The extension does not transmit sheet contents to Keep-li servers.
- **Telemetry (optional)**: Anonymised error diagnostics (stack traces, feature flags, runtime context) are sent to Keep-li infrastructure solely to detect crashes and reliability issues. Users can opt out at any time in the extension settings.

## Limited Use Disclosure for Google Sheets API

Keep-li’s access to Google Sheets is limited to appending new rows that the user saves via the extension. The extension does not read, share, or store spreadsheet contents beyond the user’s Google account. Access tokens are requested through Chrome’s `identity` API and are not persisted by Keep-li servers.

## Data Retention

- Local cached post history is retained for a maximum of 90 days or 50 items (whichever is sooner) and is automatically purged after that period.
- Telemetry metrics stored in Cloudflare KV are kept for 90 days before expiring automatically.

## Telemetry Opt-Out Instructions

Users can disable telemetry by opening **Settings → Privacy & telemetry** inside the extension and toggling off “Share anonymised diagnostics.” Opting out immediately stops further error reports and updates Sentry to drop events for that user.

## Contact

For privacy inquiries, contact privacy@keep-li.app.
