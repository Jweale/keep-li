# Google Sheets Limited Use Statement

Keep-li uses the Google Sheets API exclusively to append new rows that you explicitly save through the extension. We do not read, modify, or delete existing spreadsheet content, and we never share spreadsheet data with any third parties.

## Data Access

- OAuth tokens are requested through Chrome’s `identity.getAuthToken` flow with the `https://www.googleapis.com/auth/spreadsheets` scope.
- Tokens are stored only in the browser’s credential cache managed by Chrome and are not persisted or proxied through Keep-li servers.

## Data Usage

- When you save a post, the extension sends the prepared row directly to the Google Sheets API using your token.
- No spreadsheet content is retrieved from the API.
- Keep-li servers only receive the metadata necessary to fulfil AI summarisation requests (if enabled). Spreadsheet data never leaves your Google account.

## Data Retention

- The extension caches the most recent 50 saved posts locally to prevent duplicates and removes items older than 90 days.
- No spreadsheet content is stored on Keep-li infrastructure.

## User Control

- You can revoke the extension’s access at any time via Google Account Security → “Third-party apps with account access.”
- Within the extension settings you can disconnect Google Sheets, clear cached data, or export/remove local settings.

For questions, contact privacy@keep-li.app.
