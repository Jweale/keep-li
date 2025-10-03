-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Users table mirrors auth profiles plus licensing metadata.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  license_key text unique,
  plan text not null default 'free' check (plan in ('free','pro','lifetime')),
  created_at timestamptz not null default now()
);

-- Items captured via the extension.
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date_added timestamptz not null default now(),
  source text not null check (source in ('linkedin','web')),
  url text not null,
  url_hash text not null,
  title text not null,
  post_content text not null,
  embed_url text,
  highlight text,
  summary_160 text,
  tags text[] not null default '{}',
  intent text check (intent in ('learn','post_idea','outreach','research')),
  next_action text,
  notes text,
  author_name text,
  author_headline text,
  author_company text,
  author_url text,
  status text not null default 'inbox' check (status in ('inbox','to_use','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_user_urlhash_unique unique (user_id, url_hash)
);

create or replace function update_items_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_items_set_updated_at on items;
create trigger trg_items_set_updated_at
before update on items
for each row
execute function update_items_timestamp();

-- Optional embeddings table for semantic search / recall features.
create table if not exists item_embeddings (
  item_id uuid primary key references items(id) on delete cascade,
  embedding vector(384)
);

create index if not exists idx_items_user_date on items (user_id, date_added desc);
create index if not exists idx_items_user_urlhash on items (user_id, url_hash);
create index if not exists idx_items_user_tags on items using gin (user_id, tags);
create index if not exists idx_items_user_status_intent on items (user_id, status, intent);

alter table items enable row level security;

create policy if not exists user_can_read_items
on items for select
using (user_id = auth.uid());

create policy if not exists user_can_insert_items
on items for insert
with check (user_id = auth.uid());

create policy if not exists user_can_update_items
on items for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
