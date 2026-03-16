-- ============================================================
-- Sainsbury's Bill Splitter — Supabase schema
-- Paste this into the Supabase SQL Editor and click Run
-- ============================================================

-- Household config (people, groups)
create table if not exists config (
  id          integer primary key default 1,
  people      text[]  not null default '{}',
  groups      jsonb   not null default '[]',
  updated_at  timestamptz not null default now()
);

-- One bill per row
create table if not exists bill_history (
  id              bigint      primary key,   -- Date.now() from the client
  items           jsonb       not null,
  assignments     jsonb       not null,
  totals          jsonb       not null,
  total_bill      numeric(10,2),
  receipt_date    text,
  config_snapshot jsonb,
  saved_at        timestamptz not null default now(),
  updated_at      timestamptz           -- last time assignments were changed
);

-- Index for fast recency ordering
create index if not exists bill_history_saved_at_idx
  on bill_history (saved_at desc);

-- Seed an empty config row so GET always returns something
insert into config (id, people, groups)
values (1, '{}', '[]')
on conflict (id) do nothing;

-- ── Migration: add updated_at if upgrading from an older schema ─
-- Run this if the table already exists and just needs the new column:
-- alter table bill_history add column if not exists updated_at timestamptz;
