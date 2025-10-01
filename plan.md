# Keep-li - Development Plan

## Phase 0 – Foundations

### Repository Tooling
- [x] Run `pnpm install` at repo root and validate all workspaces
- [x] Add workspace scripts for build/dev/lint/type-check to root package.json
- [x] Set up baseline ESLint and TypeScript checks across workspaces
- [x] Configure Vitest for shared package testing

### Type Definitions & Shared Utilities
- [x] Define SheetRow interface with all required columns (timestamp, url, urlId, title, selection, status, summary)
- [x] Create SavedPost type for deduplication storage
- [x] Implement storage key constants and helpers
- [x] Test URL canonicalization and hashing across environments

### Environment Configuration
- [x] Set up extension environment config pattern (dev/prod API endpoints)
- [x] Configure Cloudflare Worker environment variables structure
- [x] Create .env.example files for both workspaces

---

## Phase 1 – Core Capture Flow (MUST)

### Popup Form Implementation
- [x] Implement form prefill logic (title from tab, URL from active tab)
- [x] Add text selection capture from page content
- [x] Build form validation with error states
- [x] Create status dropdown with persistence
- [x] Wire up save button with loading states

### Background Save Pipeline
- [x] Implement dedupe check against chrome.storage.local
- [x] Build sheet row preparation with canonicalized URL ID
- [x] Create Google Sheets OAuth flow (chrome.identity.getAuthToken)
- [x] Implement values.append API call to Google Sheets
- [x] Store saved post metadata for duplicate detection

### User Feedback & Error Handling
- [x] Show success message with "Open Sheet" action
- [x] Display duplicate detection warning with override option
- [x] Handle OAuth errors with reconnect prompt
- [x] Add network error handling and retry logic
- [x] Create notification system for background saves

### Side Panel Capture Experience
- [x] Replace popup entry point with side panel activation (manifest + chrome.sidePanel API)
- [x] Build responsive side panel layout with accessible focus management and keyboard support
- [x] Ensure side panel open/close flows work via extension icon, keyboard shortcut, and contextual triggers
- [x] Provide fallback popup behaviour for browsers without side panel support

### LinkedIn Post Capture Enhancements
- [x] Inject unobtrusive "Save post" control on each LinkedIn feed item with proper ARIA labelling
- [x] On post save, derive canonical post permalink and attach to request payload
- [x] Capture author metadata (name, headline, company, profile URL) from the active post on user action
- [x] Extend background save pipeline and shared data models with new post and author fields
- [x] Update Google Sheets append logic and schema mapping to persist new metadata
- [x] Add user messaging when per-post metadata cannot be collected

---

## Phase 2 – AI Integration (MUST)

### Managed AI Path
- [x] Implement /v1/summarize endpoint in Cloudflare Worker
- [x] Create AI provider adapter (Claude/GPT integration)
- [x] Set up KV namespace for quota tracking
- [x] Implement per-user daily quota checks and counters
- [x] Add AI toggle in popup form
- [x] Wire extension to call worker summarize endpoint

### BYO-Key Mode
- [-] Add API key input in settings page
- [-] Store API keys securely in chrome.storage.local
- [-] Implement direct provider calls from extension
- [-] Create toggle between managed/BYO modes
- [-] Add validation for API key format

### AI Error Handling
- [x] Implement timeout handling (fallback to non-AI save)
- [x] Add quota exhaustion detection and messaging
- [x] Create fallback flow when AI fails
- [x] Log AI telemetry events (success/fail/timeout)
- [x] Show graceful degradation UX

---

## Phase 3 – Onboarding & Settings (MUST)

### First-Run Flow
- [x] Detect first install via chrome.runtime.onInstalled
- [x] Create onboarding page for Sheet ID entry
- [x] Implement Google OAuth connection test
- [x] Fetch feature flags from worker
- [x] Add optional license key entry field
- [x] Store onboarding completion state

### Settings Page
- [x] Build settings UI with React
- [x] Add "Reconnect Google Account" button
- [x] Create "Open My Sheet" quick link
- [x] Add export/import settings functionality

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

**Active Phase:** Phase 1 – Core Capture Flow  
**Next Action:** Ship side panel capture experience and LinkedIn post-level save enhancements
