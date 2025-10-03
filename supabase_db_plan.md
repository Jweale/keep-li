# Supabase-First Milestones

## Milestone 1 – Supabase Foundation
- Spin up Supabase project (environment, keys, RLS defaults)
  - Create a new Supabase project in the dashboard and note the generated project URL/keys.
  - Invite teammates and enforce password manager storage for the service role key (never expose to clients).
- Apply database schema (users, items, indexes, triggers)
  - Install the Supabase CLI and link the project: `supabase login` → `supabase link --project-ref <project-ref>`.
  - Run `supabase db push` (or copy/paste) using `supabase/schema.sql` to create tables, indexes, and policies.
- Configure service role/anon keys and local secrets handling
  - Populate the new variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) in `api/.env.example` and matching Wrangler secrets.
  - Add matching Vite variables (`VITE_SUPABASE_URL*`, `VITE_SUPABASE_ANON_KEY*`) in `extension/.env.example` and the real `.env` values for local development.

## Milestone 2 – Worker API Enablement
- Extend worker config to read Supabase credentials
- Implement Supabase service client (auth check, insert/find helpers)
- Expose `/v1/save` endpoint that writes to Supabase while keeping Sheets untouched

## Milestone 3 – Extension Dual Write (Optional Transition)
- Background script: obtain Supabase session, call new `/v1/save`
- Persist Supabase session tokens and reconcile duplicate handling
- Continue Google Sheets append as current source of truth while Supabase ingests in parallel

## Milestone 4 – Dashboard Skeleton (Read-Only)
- Set up Next.js/Tailwind dashboard app with Supabase Auth
- Build basic table view, filters, search against Supabase `items`
- Verify RLS by logging in with different users

## Milestone 5 – Cutover Preparation
- Validate data parity between Sheets and Supabase
- Add migration script (Sheets export → Supabase import) if needed
- Feature flag in extension to toggle Sheets off once Supabase is trusted
