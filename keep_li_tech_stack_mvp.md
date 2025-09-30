# Tech Stack — LinkedIn Saves → Sheets (MVP)

> **Design principles:** Simplicity, speed, easy maintenance, extendability. LinkedIn-specific UX. No scraping. User data lives in a Google Sheet. Managed AI by default with BYO-key fallback.

---

## 1) Chrome Extension (Manifest V3)

**Language & tooling**

- TypeScript
- React (popup UI) + Vite + `@crxjs/vite-plugin` (MV3 build + HMR)
- Tailwind CSS (utility-only)
- Zustand (tiny state)
- ESLint + Prettier
- Tests (lightweight for MVP): Vitest + @testing-library/react (optional: Playwright in v1.1)

**Permissions**

- `activeTab`, `storage`
- Optional: `clipboardRead`
- `commands` for global shortcut (Cmd/Ctrl-Shift-S)

**Architecture**

- **Popup UI:** single screen. Fields: `url` (readonly), `title` (editable), optional `notes`, AI toggle, `status` select; primary CTA = **Save to Sheet**.
- **Background service worker:** Google OAuth + Sheets append, AI request orchestration, dedupe logic.
- **Content scripts:** none for MVP (keeps risk low).

**URL canonicalisation & dedupe**

- Normalise URLs (strip UTMs/fragments)
- Compute `url_hash` (e.g., SHA-1) and keep an LRU set in `chrome.storage` to prevent duplicates within recent saves

**Keyboard shortcut**

- `open_popup` → suggested key: Cmd/Ctrl-Shift-S

---

## 2) Google Sheets Integration (client-side)

**Auth**

- `chrome.identity` OAuth 2.0 with minimal scope: `https://www.googleapis.com/auth/spreadsheets`

**API Usage**

- Single call: `spreadsheets.values.append` to tab `Saves`
- Header schema (fixed):\
  `date_added | source | url | title | highlight | summary_160 | tags | intent | next_action | status | url_hash | notes`

**Resilience**

- Token expiry → inline **Reconnect** flow
- Append failure → show “Copy payload” fallback so nothing is lost

---

## 3) Managed AI Backend (no content storage)

**Runtime**

- Cloudflare Workers (global, cheap, fast)

**Framework & validation**

- Hono (router) + Zod (runtime validation)

**Endpoints**

- `POST /v1/summarize`\
  **Request:** `{ licenseKey, title, url, highlight }` (highlight ≤ 1,000 chars)\
  **Response:** `{ summary_160, tags[], intent, next_action, usage:{in,out} }`
- `GET /v1/usage` (optional UI badge), simple counters

**Quotas & billing**

- Validate **license key** (Lemon Squeezy or Paddle) on each request
- Enforce quotas via Cloudflare KV counters (per-month)

**Security & privacy**

- CORS allowlist (extension origin), rate limiting, input size caps
- **No raw content persisted**; keep only token counts/latency (≤30 days)
- Structured logs with redaction; Sentry for errors

**BYO-key fallback**

- If enabled in the extension, call provider directly client-side with the user’s key (bypasses backend entirely)

---

## 4) AI Provider Abstraction

**Default behaviour**

- Use a **small/fast text model** for low latency and cost
- Cap input (≤1,000 chars) and keep prompts short/deterministic (e.g., temperature 0.2–0.3)

**Adapter interface**

```ts
type SummarizeInput = { url: string; title?: string; highlight?: string };
type SummarizeOutput = {
  summary_160: string;
  tags: string[];
  intent: 'learn'|'post_idea'|'outreach'|'research';
  next_action: string;
  tokens_in: number;
  tokens_out: number;
};
```

**Extendability**

- Add providers behind the same interface without touching extension code

---

## 5) Payments & Licensing

**Option A (recommended):** Lemon Squeezy subscriptions + license keys\
**Option B:** Paddle (VAT handling, also good)

**Flow**

- User enters license key in Settings
- Extension sends key with each `/v1/summarize` call
- Backend verifies + rate limits; cache license status in memory for a few minutes

**Plans (MVP)**

- Free: unlimited non-AI saves + 10 AI saves/mo
- Pro (£6-8/mo): 100 AI saves/mo

---

## 6) Observability & Feature Flags

- Sentry (extension + worker)
- Minimal counters in KV (requests/day, errors, avg latency)
- Remote JSON for feature flags (fetched by extension at startup), stored in KV

---

## 7) Security, Privacy & Compliance

- **No LinkedIn scraping or background crawling**; user-initiated capture only
- Chrome Web Store **Limited Use**: collect only what’s necessary; transparent disclosures
- PII minimisation: user-selected text only; char limit; no server storage of content
- TLS everywhere; CSP for the popup; lockfile + Dependabot for supply chain

---

## 8) Repo & CI/CD

**Monorepo (pnpm workspaces)**

```
/extension   # MV3 React app
  src/
    background/service-worker.ts
    popup/App.tsx
    popup/index.html
    lib/
    storage/
    types/
  public/icons/
  manifest.json
  vite.config.ts

/api         # Cloudflare Workers
  src/index.ts
  src/routes/summarize.ts
  src/lib/providers/openai.ts
  src/lib/usage.ts
  wrangler.toml

/shared      # Types & utilities shared by both
  src/types.ts
  src/url.ts
  tsconfig.json
```

**CI/CD**

- GitHub Actions → lint, typecheck, test, build
- Deploy Workers via `wrangler publish`
- Upload extension via Chrome Web Store API (manual review still applies)

---

## 9) Browser Compatibility

- **Minimum:** Chrome 114+ (MV3)
- Edge port considered post-MVP
- Firefox out of scope (MV3/API differences)

---

## 10) Minimal `manifest.json` (snippet)

```json
{
  "manifest_version": 3,
  "name": "Saves → Sheets for LinkedIn",
  "version": "0.1.0",
  "permissions": ["storage", "activeTab"],
  "optional_permissions": ["clipboardRead"],
  "action": { "default_popup": "popup/index.html" },
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "commands": {
    "open_popup": {
      "suggested_key": { "default": "Ctrl+Shift+S", "mac": "Command+Shift+S" },
      "description": "Open Save popup"
    }
  },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

---

## 11) Dependencies (pin major versions)

**Extension**

- runtime: `react`, `react-dom`, `zustand`, `zod`
- dev: `vite`, `@crxjs/vite-plugin`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `eslint`, `@types/chrome`, `chrome-types`, `vitest`, `@testing-library/react`

**API**

- runtime: `hono`, `zod`, `undici` (or native fetch), `@sentry/worker` (optional)
- dev: `wrangler`, `typescript`

---

## 12) Environment & Config

**Extension (env-like constants)**

- `API_BASE_URL`
- `EXT_DEFAULT_AI_ENABLED` (true/false)
- `EXT_AI_CHAR_LIMIT` (e.g., 1000)
- `SENTRY_DSN_EXTENSION`

**Workers (wrangler secrets)**

- `OPENAI_API_KEY` (or other provider key)
- `LICENSE_API_KEY` / marketplace secret
- `SENTRY_DSN_API`

**KV namespaces**

- `USAGE_KV` for quotas & counters
- `FLAGS_KV` for feature flags

---

## 13) Roadmap Hooks (post-MVP)

- Quick-Find panel in the popup (client-side search over last 50 rows)
- CSV export button
- Clipboard watcher for LinkedIn “Copy link to post” URLs → prompt to save
- Additional destinations: Notion/Airtable
- Weekly resurfacing email via Workers Cron triggers
- Local embeddings for semantic related-items (client-only)

