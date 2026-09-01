-- ============================================================
-- Payment Plans — Supabase schema  (table prefix: pp_)
--
-- Lives in the "Home" Supabase project, alongside the home_ tables.
-- Deliberately NOT in the Sainsbury's splitter's project: that one is in
-- a free org and pauses after a period of inactivity.
--
-- Already applied via migrations pp_payment_plans_init,
-- pp_revoke_anon_execute and pp_people_is_me. Kept here as the
-- readable record of the schema, and so it can be rebuilt from scratch.
-- ============================================================

-- ── Access control ──────────────────────────────────────────
create table if not exists pp_members (
  email    text primary key,
  label    text,
  role     text not null default 'reader',   -- 'owner' | 'reader'
  added_at timestamptz not null default now()
);
comment on table pp_members is
  'Who may reach the pp_ tables, and whether they may write. Membership is by verified email address, so someone can be added before they have ever signed in.';

create or replace function pp_is_member() returns boolean
  language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select exists (
    select 1 from public.pp_members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function pp_is_owner() returns boolean
  language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select exists (
    select 1 from public.pp_members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and m.role = 'owner'
  );
$$;

-- Only ever called from inside RLS policies, never over the REST rpc
-- endpoint, so anon has no business executing them.
revoke execute on function public.pp_is_member() from anon;
revoke execute on function public.pp_is_owner()  from anon;

create or replace function pp_touch_updated_at() returns trigger
  language plpgsql set search_path to 'public','pg_catalog'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── People who owe money (not accounts) ─────────────────────
create table if not exists pp_people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text,
  colour_idx integer not null default 0,
  email      text,
  archived   boolean not null default false,
  is_me      boolean not null default false,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table pp_people is
  'Humans who owe money on a bill. Not accounts — these people do not sign in.';
comment on column pp_people.is_me is
  'One person represents the ledger owner. Their share of a bill is money they were never going to receive, so it is excluded from "owed to me" and from arrears, but still counts toward the bill being fully allocated.';

create unique index if not exists pp_people_single_me
  on pp_people ((true)) where is_me;

-- ── Bills ───────────────────────────────────────────────────
create table if not exists pp_bills (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text,
  vendor        text,
  total_amount  numeric(12,2) not null default 0 check (total_amount >= 0),
  purchase_date date,
  status        text not null default 'active'
                check (status in ('active','settled','archived')),
  notes         text,
  plan_start    date,
  plan_months   integer check (plan_months is null or plan_months between 1 and 120),
  plan_due_day  integer not null default 1 check (plan_due_day between 1 and 28),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column pp_bills.plan_due_day is
  'Capped at 28 so every month has the day — no February drift.';

-- ── Who owes what on a bill ─────────────────────────────────
create table if not exists pp_shares (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references pp_bills(id)  on delete cascade,
  person_id   uuid not null references pp_people(id) on delete cascade,
  share_type  text not null default 'equal'
              check (share_type in ('equal','percent','fixed')),
  share_value numeric(12,4),
  amount_owed numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (bill_id, person_id)
);
comment on column pp_shares.amount_owed is
  'Resolved share in pounds, stored pence-exact so the shares always sum to the bill total.';

-- ── The generated repayment schedule ────────────────────────
create table if not exists pp_instalments (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references pp_bills(id)  on delete cascade,
  person_id  uuid not null references pp_people(id) on delete cascade,
  seq        integer not null,
  due_date   date not null,
  amount     numeric(12,2) not null default 0,
  waived     boolean not null default false,
  note       text,
  created_at timestamptz not null default now(),
  unique (bill_id, person_id, seq)
);
comment on table pp_instalments is
  'What should have arrived by when. Payments are never matched to a specific instalment — the schedule sets expectations, pp_payments_in records cash. That is what lets a lump sum, a short payment or a skipped month all work without any reconciliation UI.';

-- ── Money in (from the people who owe) ──────────────────────
create table if not exists pp_payments_in (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references pp_bills(id)  on delete cascade,
  person_id  uuid not null references pp_people(id) on delete cascade,
  paid_on    date not null default current_date,
  amount     numeric(12,2) not null,
  method     text,
  note       text,
  created_at timestamptz not null default now()
);

-- ── Money out (what I pay to clear the bill) ────────────────
create table if not exists pp_payments_out (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references pp_bills(id) on delete cascade,
  paid_on    date not null default current_date,
  amount     numeric(12,2) not null,
  payee      text,
  method     text,
  note       text,
  scheduled  boolean not null default false,
  created_at timestamptz not null default now()
);
comment on column pp_payments_out.scheduled is
  'true = a future payment I have committed to but not yet made, so the cashflow view can look forward. false = money that has actually left.';

-- ── Indexes ─────────────────────────────────────────────────
create index if not exists pp_shares_bill_idx        on pp_shares (bill_id);
create index if not exists pp_instalments_bill_idx   on pp_instalments (bill_id);
create index if not exists pp_instalments_due_idx    on pp_instalments (due_date);
create index if not exists pp_payments_in_bill_idx   on pp_payments_in (bill_id);
create index if not exists pp_payments_in_paid_idx   on pp_payments_in (paid_on);
create index if not exists pp_payments_out_bill_idx  on pp_payments_out (bill_id);
create index if not exists pp_payments_out_paid_idx  on pp_payments_out (paid_on);

-- ── updated_at triggers ─────────────────────────────────────
drop trigger if exists pp_people_touch on pp_people;
create trigger pp_people_touch before update on pp_people
  for each row execute function pp_touch_updated_at();

drop trigger if exists pp_bills_touch on pp_bills;
create trigger pp_bills_touch before update on pp_bills
  for each row execute function pp_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
alter table pp_members      enable row level security;
alter table pp_people       enable row level security;
alter table pp_bills        enable row level security;
alter table pp_shares       enable row level security;
alter table pp_instalments  enable row level security;
alter table pp_payments_in  enable row level security;
alter table pp_payments_out enable row level security;

drop policy if exists pp_members_read on pp_members;
create policy pp_members_read on pp_members for select using (pp_is_member());

do $$
declare t text;
begin
  foreach t in array array['pp_people','pp_bills','pp_shares','pp_instalments','pp_payments_in','pp_payments_out']
  loop
    execute format('drop policy if exists %I on %I', t || '_member_read', t);
    execute format('create policy %I on %I for select using (pp_is_member())', t || '_member_read', t);
    execute format('drop policy if exists %I on %I', t || '_owner_write', t);
    execute format('create policy %I on %I for all using (pp_is_owner()) with check (pp_is_owner())', t || '_owner_write', t);
  end loop;
end $$;

-- ── Seed the owner ──────────────────────────────────────────
insert into pp_members (email, label, role)
values ('richardbarley@gmail.com', 'Richard', 'owner')
on conflict (email) do update set role = 'owner';
