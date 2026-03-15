-- ============================================================
-- Sainsbury's Bill Splitter — Supabase schema
-- Paste this into the Supabase SQL Editor and click Run
-- ============================================================

-- Household config (people, groups)
-- Single row for now; extend to multi-household by adding more rows later
create table if not exists config (
  id          integer primary key default 1,
  people      text[]  not null default '{}',
  groups      jsonb   not null default '[]',
  updated_at  timestamptz not null default now()
);

-- One bill per row makes history easy to query / extend
create table if not exists bill_history (
  id              bigint      primary key,   -- Date.now() from the client
  items           jsonb       not null,
  assignments     jsonb       not null,
  totals          jsonb       not null,
  total_bill      numeric(10,2),
  receipt_date    text,
  config_snapshot jsonb,
  saved_at        timestamptz not null default now()
);

-- Index for fast recency ordering
create index if not exists bill_history_saved_at_idx
  on bill_history (saved_at desc);

-- Seed an empty config row so GET always returns something
insert into config (id, people, groups)
values (1, '{}', '[]')
on conflict (id) do nothing;
