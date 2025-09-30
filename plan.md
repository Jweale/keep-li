# Keep-li - Development Plan

## Phase 0 – Foundations

### Repository Tooling
- [x] Run `pnpm install` at repo root and validate all workspaces
- [x] Add workspace scripts for build/dev/lint/type-check to root package.json
- [x] Set up baseline ESLint and TypeScript checks across workspaces
- [x] Configure Vitest for shared package testing

### Type Definitions & Shared Utilities
- [ ] Define SheetRow interface with all required columns (timestamp, url, urlId, title, selection, status, summary)
- [ ] Create SavedPost type for deduplication storage
- [ ] Implement storage key constants and helpers
- [ ] Test URL canonicalization and hashing across environments

### Environment Configuration
- [ ] Set up extension environment config pattern (dev/prod API endpoints)
- [ ] Configure Cloudflare Worker environment variables structure
- [ ] Create .env.example files for both workspaces

---

## Phase 1 – Core Capture Flow (MUST)

### Popup Form Implementation
- [ ] Implement form prefill logic (title from tab, URL from active tab)
- [ ] Add text selection capture from page content
- [ ] Build form validation with error states
- [ ] Create status dropdown with persistence
- [ ] Wire up save button with loading states

### Background Save Pipeline
- [ ] Implement dedupe check against chrome.storage.local
- [ ] Build sheet row preparation with canonicalized URL ID
- [ ] Create Google Sheets OAuth flow (chrome.identity.getAuthToken)
- [ ] Implement values.append API call to Google Sheets
- [ ] Store saved post metadata for duplicate detection

### User Feedback & Error Handling
- [ ] Show success message with "Open Sheet" action
- [ ] Display duplicate detection warning with override option
- [ ] Handle OAuth errors with reconnect prompt
- [ ] Add network error handling and retry logic
- [ ] Create notification system for background saves

---

## Phase 2 – AI Integration (MUST)

### Managed AI Path
- [ ] Implement /v1/summarize endpoint in Cloudflare Worker
- [ ] Create AI provider adapter (Claude/GPT integration)
- [ ] Set up KV namespace for quota tracking
- [ ] Implement per-user daily quota checks and counters
- [ ] Add AI toggle in popup form
- [ ] Wire extension to call worker summarize endpoint

### BYO-Key Mode
- [ ] Add API key input in settings page
- [ ] Store API keys securely in chrome.storage.local
- [ ] Implement direct provider calls from extension
- [ ] Create toggle between managed/BYO modes
- [ ] Add validation for API key format

### AI Error Handling
- [ ] Implement timeout handling (fallback to non-AI save)
- [ ] Add quota exhaustion detection and messaging
- [ ] Create fallback flow when AI fails
- [ ] Log AI telemetry events (success/fail/timeout)
- [ ] Show graceful degradation UX

---

## Phase 3 – Onboarding & Settings (MUST)

### First-Run Flow
- [ ] Detect first install via chrome.runtime.onInstalled
- [ ] Create onboarding page for Sheet ID entry
- [ ] Implement Google OAuth connection test
- [ ] Fetch feature flags from worker
- [ ] Add optional license key entry field
- [ ] Store onboarding completion state

### Settings Page
- [ ] Build settings UI with React
- [ ] Add "Reconnect Google Account" button
- [ ] Create AI toggle defaults section
- [ ] Implement license key management
- [ ] Add BYO API key configuration
- [ ] Create "Open My Sheet" quick link
- [ ] Add export/import settings functionality

---

## Phase 4 – Enhancements (SHOULD)

### UX Improvements
- [ ] Persist last-used status dropdown value
- [ ] Add visual cues for status options (colors/icons)
- [ ] Create confirmation dialog for duplicate override
- [ ] Implement keyboard shortcut handler
- [ ] Add shortcut instructions to settings page

### Telemetry
- [ ] Create /v1/telemetry endpoint in worker
- [ ] Implement event batching in extension
- [ ] Track install/uninstall events
- [ ] Log save events (with/without AI)
- [ ] Monitor AI usage metrics
- [ ] Add privacy-safe error reporting

---

## Phase 5 – Infrastructure & Compliance (MUST)

### Cloudflare Deployment
- [ ] Set up Cloudflare Workers deployment pipeline
- [ ] Configure KV namespaces (prod/staging)
- [ ] Implement secrets management (API keys, OAuth)
- [ ] Add wrangler.toml configuration
- [ ] Create CI/CD workflow for worker deployment

### Privacy & Compliance
- [ ] Add privacy policy disclosure in extension
- [ ] Create limited-use statement for Google Sheets API
- [ ] Implement data retention policies
- [ ] Add telemetry opt-out mechanism
- [ ] Prepare Chrome Web Store metadata with disclosures

### Observability
- [ ] Integrate Sentry SDK in extension
- [ ] Add Sentry to Cloudflare Worker
- [ ] Implement structured logging
- [ ] Create error reporting pipeline
- [ ] Set up monitoring dashboards

---

## Phase 6 – Polishing & QA (COULD)

### Testing
- [ ] Write Vitest tests for shared utilities
- [ ] Add React Testing Library tests for popup components
- [ ] Create unit tests for popup store/hooks
- [ ] Write integration tests with chrome API mocks
- [ ] Test service worker message handling
- [ ] Add E2E tests for critical flows

### Manual QA Scripts
- [ ] Test cold install flow
- [ ] Verify OAuth expiry and reconnect
- [ ] Simulate AI quota exhaustion
- [ ] Test duplicate detection edge cases
- [ ] Validate keyboard shortcuts
- [ ] Check all error states and recovery flows

### Chrome Web Store Prep
- [ ] Optimize and validate extension icons
- [ ] Create promotional screenshots
- [ ] Write store description and feature list
- [ ] Prepare privacy policy page
- [ ] Compile review response document
- [ ] Submit for review

---

## Notes

- **Phase 0-1** must be completed first for basic functionality
- **Phase 2-3** are MVP-critical features
- **Phase 4** can be partially deferred post-launch
- **Phase 5** required before public release
- **Phase 6** should be ongoing throughout development

## Current Status

**Active Phase:** Phase 0 - Foundations  
**Next Action:** Run `pnpm install` and validate workspace configuration
