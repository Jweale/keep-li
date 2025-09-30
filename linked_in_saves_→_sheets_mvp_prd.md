# Product Requirements Document (PRD)

## Product

**Working name:** LinkedIn Saves → Sheets (MVP)

**One‑liner:** Save the LinkedIn posts you care about into your own Google Sheet—fast. Add AI‑ready context (summary, tags, intent, next action) without scraping or risking your account.

---

## Problem & Opportunity

- **Problem:** LinkedIn’s native *Saved* items are hard to organise, search, and reuse. There’s no simple way to add structure or export for personal knowledge workflows.
- **Opportunity:** Provide a compliant, ultra‑simple capture flow that turns *each interesting LinkedIn post* into a structured row in the user’s Google Sheet—owned by them—augmented by light AI so it’s easy to find and act on later.

**Non‑negotiable focus:** *LinkedIn‑specific UX*. We optimise for saving **LinkedIn posts** (but technically work on any webpage). No scraping or background crawling.

---

## Goals (MVP)

1. **Simplicity:** Save a LinkedIn post to a Google Sheet in ≤ 2 clicks / ≤ 2 seconds.
2. **Useful recall:** Every saved row has enough context to filter later: `summary_160`, `tags`, `intent`, `next_action`.
3. **Data ownership:** Content lives in the user’s Google Sheet. We don’t keep their content server‑side.
4. **Compliance:** No LinkedIn DOM scraping, no bulk export. All user‑initiated.

### Success Metrics (first 30 days)

- **A1:** ≥ 75% of new users complete first save within 2 minutes of install.
- **A2:** Median save latency (press → row appended) ≤ 1.5s (excluding first‑time OAuth).
- **A3:** ≥ 50% of saves include an AI summary (managed AI path), with error rate < 2%.
- **A4:** < 1% duplicate‑row rate across first 100 saves per user.

---

## Personas

- **Primary:** LinkedIn power user / creator who saves posts for later reuse (ideas, research, outreach). Wants speed, structure, ownership.
- **Secondary:** B2B marketer / consultant building a swipe‑file of examples and research.

---

## Scope (MVP)

### In‑scope

- **Chrome extension (MV3)** with a minimal popup.
- **Capture from LinkedIn:** URL, page title, timestamp. If user has selected text, capture as `highlight`.
- **Append to Google Sheet** via user’s OAuth (chrome.identity) — one predefined schema.
- **Managed AI** (default): call our `/v1/summarize` endpoint on the user‑selected text to produce `summary_160`, `tags`, `intent`, `next_action`.
- **BYO API key** (optional): local AI processing if the user prefers privacy mode.
- **Dedupe & canonicalise URLs** (strip UTMs, fragments; short LRU memory to avoid immediate duplicates).
- **Keyboard shortcut** (Cmd/Ctrl‑Shift‑S) to open popup with prefilled fields.

### Out of scope (MVP)

- **No** LinkedIn scraping (no saved‑library export, no DOM crawling on feeds).
- **No** accounts or content storage on our server (only ephemeral AI processing).
- **No** team sharing / multi‑user Sheets.
- **No** semantic search UI (Sheets filters cover v1 needs).

---

## User Stories (MoSCoW)

**Must**

1. As a user on a LinkedIn post, I can press the shortcut → see a popup with URL/title auto‑filled and Save.
2. As a user, I can select text on a LinkedIn post and include it as `highlight`.
3. As a user, I can toggle **“Add AI summary & tags”** before saving.
4. As a user, I can paste my **Google Sheet ID** once, and reconnect if auth expires.
5. As a user, I can upgrade to Pro to unlock higher AI quota.

**Should**
6\. As a user, I get dedupe detection if I try to save the same LinkedIn URL again.
7\. As a user, I can set a `status` from a small list (`inbox`, `to_use`, `archived`).

**Could**
8\. As a user, I can save from any website with the same flow (source auto‑labels `linkedin` vs `web`).

**Won’t (MVP)**
9\. Bulk import of LinkedIn Saved items, Notion/Airtable sync, team shared Sheet.

---

## UX Principles

- **One screen. One button.** The popup contains only what’s needed to ship a row.
- **LinkedIn‑first:** Microcopy guides users to select post text for best AI results.
- **Fail soft:** If AI/API is unavailable, still save the row instantly.

---

## Core Flows

### 1) First‑run onboarding

- Install → Click extension → Paste Google Sheet URL → "Connect Google" (OAuth) → Test append → Done.

### 2) Save a LinkedIn post

- User opens a LinkedIn post (or detail permalinks). Optional: selects a paragraph.
- Hit **Cmd/Ctrl‑Shift‑S** → Popup shows prefilled `title`, `url`, and selection preview.
- Toggle **AI summary** (default ON). Click **Save to Sheet**.
- Extension: (a) Canonicalise URL; (b) Dedupe check; (c) Append row; (d) Toast “Saved”.

### 3) Reconnect

- If Sheets 401/expired token → show inline **Reconnect** button → retry append.

### 4) Upgrade (managed AI quota)

- When user hits free AI limit → inline message with **Enter license key** field + “Upgrade” link.

---

## Functional Requirements

### Extension (MV3)

- **Permissions:** `activeTab`, `storage`; (optional) `clipboardRead`.
- **Commands:** Shortcut `Cmd/Ctrl‑Shift‑S` to open popup.
- **Popup UI:**
  - Fields: `url` (readonly), `title` (editable).

  - Textarea (optional): `notes` → appended after AI fields as freeform (column `notes`).
  - Toggle: **Add AI summary & tags** (default ON).
  - Select: `status` (`inbox` default).
  - Primary CTA: **Save to Sheet**.
  - Link: **Open Sheet**.
- **Dedupe & Canonicalisation:**
  - Strip `utm_*`, `?tracking` params; remove `#fragments`.
  - Compute `url_hash` (SHA‑1) and keep a small LRU map in `chrome.storage`.
  - If duplicate within last N saves → inline prompt: “Already saved. Save anyway?”
- **Error handling:**
  - Graceful fallback when Sheets append fails (show copy‑to‑clipboard JSON payload so nothing is lost).
  - AI timeout (1.5s). On timeout, save without AI.

### Google Sheets Integration

- **Auth:** chrome.identity → Sheets scope `spreadsheets`.
- **Append:** Single `values.append` call to a known sheet/tab (e.g., `Saves`).
- **Reconnect:** Detect 401 → show reconnect CTA, retry once on success.

### Managed AI Backend

- **Runtime:** Cloudflare Workers; **Router:** Hono; **Validation:** Zod.
- **Endpoint:** `POST /v1/summarize`
  - **Request** (max 1,000 chars highlight):
    ```json
    {
      "licenseKey": "lsq_xxx",
      "title": "...",
      "url": "https://www.linkedin.com/...",
      "highlight": "(optional user-selected text)"
    }
    ```
  - **Response:**
    ```json
    {
      "summary_160": "One or two crisp sentences (≤160 chars)",
      "tags": ["ABM", "positioning", "case-study"],
      "intent": "learn|post_idea|outreach|research",
      "next_action": "Draft a post: ...",
      "usage": {"in": 300, "out": 80}
    }
    ```
- **Quotas:** Free: 25 AI saves/mo; Pro: 1,000/mo. Enforced by license lookup + KV counters.
- **No content storage:** Only token counts and latency are logged (30‑day retention). No raw text persisted.

### BYO AI (Optional)

- Toggle in Settings: paste personal API key. Calls provider directly from extension. Same prompt schema; never touches our server.

---

## Data Model (Google Sheet Schema)

| Column        | Type       | Description                                                |
| ------------- | ---------- | ---------------------------------------------------------- |
| `date_added`  | ISO string | `new Date().toISOString()`                                 |
| `source`      | enum       | `linkedin` if hostname contains `linkedin.com`, else `web` |
| `url`         | string     | Canonicalised URL                                          |
| `title`       | string     | Document title at capture                                  |
| `highlight`   | string     | User‑selected snippet (optional)                           |
| `summary_160` | string     | AI summary ≤160 chars (optional)                           |
| `tags`        | CSV        | 3–5 tags (lowercase, kebab or comma‑separated)             |
| `intent`      | enum       | `learn`, `post_idea`, `outreach`, `research`               |
| `next_action` | string     | One‑sentence suggestion                                    |
| `status`      | enum       | `inbox` (default), `to_use`, `archived`                    |
| `url_hash`    | string     | Internal dedupe aid (not shown in UI)                      |
| `notes`       | string     | Optional free‑text from popup                              |

> **Note:** MVP UI doesn’t expose editing past rows; users edit directly in Sheets.

---

## AI Prompt (managed & BYO)

**System:** “You help summarise LinkedIn posts users selected. Be concise and practical.”
**User Template:**

```
URL: <url>
TITLE: <title>
HIGHLIGHT (≤1000 chars, optional): <highlight>
Task: Create 4 fields.
1) summary_160: ≤160 chars, factual; no emojis.
2) tags: 3–5 topical tags (lowercase, no spaces; use hyphens where needed).
3) intent: one of [learn|post_idea|outreach|research].
4) next_action: 1 sentence suggesting how to reuse this post.
Return JSON only.
```

---

## Non‑Functional Requirements

- **Performance:** save action P50 ≤ 1.5s, P95 ≤ 2.5s (post‑OAuth).
- **Privacy:** no raw text stored on server; TLS everywhere; least‑privilege scopes.
- **Reliability:** extension recovers from worker/API failure by saving non‑AI row.
- **Compatibility:** latest Chrome (MV3). Edge support optional later.

---

## Compliance & Policy

- **LinkedIn:** No scraping/automation. User‑initiated capture only.
- **Chrome Web Store:** Limited Use policy: collect only what’s needed; clear disclosures; no repurposing data.
- **GDPR/UK GDPR:** Publish a plain‑English privacy policy (lawful basis: consent, minimal data, 30‑day logs without content).

---

## Pricing & Licensing (MVP)

- **Free:** Unlimited non‑AI saves; 25 AI saves/month.
- **Pro (£4–6/mo):** 1,000 AI saves/month.
- **License keys** (Lemon Squeezy) validated by backend per request.

---

## Telemetry (minimal)

- Events (no content): `install`, `onboard_complete`, `save_attempt`, `save_success`, `ai_used`, `ai_quota_block`, `reconnect_success`, `error_sheets`, `error_ai`.
- Metrics: save latency, AI usage counts.

---

## Acceptance Criteria

1. From a LinkedIn post, pressing the shortcut and clicking **Save** creates a new row with `date_added|source=linkedin|url|title` populated.
2. Selecting text before saving populates `highlight` accordingly.
3. With AI toggled ON and quota available, `summary_160|tags|intent|next_action` are filled; with AI OFF or timeout, row still saves.
4. Duplicate URL within last N saves triggers a prompt and doesn’t create a second row unless confirmed.
5. Revoked/expired OAuth shows **Reconnect** and succeeds on retry.
6. No background network calls to LinkedIn pages.

---

## Risks & Mitigations

- **User expects bulk import of LinkedIn Saved library.** → Explicit copy: we don’t bulk import to protect your account; here’s the fast manual flow.
- **OAuth friction.** → First‑run guided test append + clear reconnect CTA.
- **AI cost spikes.** → Quotas + 1,000‑char cap + server kill‑switch per license/day.
- **Extension review delays.** → Clear store listing & privacy; minimal permissions.

---

## Launch Checklist

- Privacy policy (≤500 words) + Limited Use disclosure.
- Store listing: screenshots (install, popup, Sheet row), concise description, support email.
- Feature flag defaults: Managed AI ON, BYO OFF.
- Sentry DSNs configured (extension + worker).
- QA on cold profile: fresh Chrome, new Sheet, first‑run OAuth.

---

## Post‑MVP Backlog (v1.1 → v2)

- Quick‑Find panel (search last 50 saves in popup).
- CSV export button.
- Clipboard watcher for LinkedIn “Copy link to post” → suggest Save.
- Notion/Airtable destination options.
- Weekly resurfacing email (top unread by tag/intent).
- Local embeddings for semantic related‑items (client‑side).

---

## Open Questions

- **Decision:** Keep it simple for MVP — users paste their Google Sheet ID (no Drive API pre‑creation).
- **Decision:** `title` is editable in the popup for MVP.
- **Decision:** Minimum Chrome version support: **Chrome 114+**.---

## Appendix

### Minimal UI Microcopy (Popup)

- Title: **Save to Google Sheet**
- Checkbox: **Add AI summary & tags**
- Select: **Status** (`inbox`, `to_use`, `archived`)
- Button: **Save to Sheet**
- Hint (shown on linkedin.com): *Tip: select a snippet from the post for better tags.*

### Error Messages

- **Sheets reconnect needed.** “Session expired. Reconnect to Google and try again.”
- **Duplicate detected.** “Looks like you’ve already saved this post. Save again?”
- **AI unavailable.** “Saved without AI. You can add summary later.”

