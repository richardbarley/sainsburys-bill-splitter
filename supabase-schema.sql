-- ============================================================
-- Sainsbury's Bill Splitter — Supabase schema  (HISTORY — not applied anywhere)
--
-- This is the schema as it was on the splitter's own project, before the
-- move into the suite's Home project in September 2026. The live tables are
-- bs_config and bs_bill_history, created by barley-home migration
-- 0009_bills.sql, which is the schema and the record of what changed:
-- no `admins` array (an owner on the hub replaces it) and no assigned_*
-- columns (nothing read them). Kept for reading, not for running.
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
  updated_at      timestamptz,          -- last time assignments were changed
  assigned_to     text,                 -- email of assignee
  assigned_by     text,                 -- email of person who assigned
  assigned_status text,                 -- 'pending' | 'completed'
  completed_by    text,
  completed_at    timestamptz
);

-- Index for fast recency ordering
create index if not exists bill_history_saved_at_idx
  on bill_history (saved_at desc);

-- Seed an empty config row so GET always returns something
insert into config (id, people, groups)
values (1, '{}', '[]')
on conflict (id) do nothing;

-- ── Migration: run these if upgrading from an older schema ──────
alter table bill_history add column if not exists updated_at     timestamptz;
alter table bill_history add column if not exists assigned_to    text;
alter table bill_history add column if not exists assigned_by    text;
alter table bill_history add column if not exists assigned_status text;
alter table bill_history add column if not exists completed_by   text;
alter table bill_history add column if not exists completed_at   timestamptz;

-- Enable real-time for live notifications (run once in Supabase dashboard
-- OR via: supabase realtime enable bill_history)
-- In the Supabase dashboard: Database → Replication → bill_history → toggle on
