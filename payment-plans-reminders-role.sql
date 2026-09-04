-- pp_reminders: the reminder sender's own login, instead of the service key.
--
-- netlify/functions/plans-reminders.js used to hold the Home project's
-- service key as PLANS_SUPABASE_SERVICE_KEY. That key ignores RLS and holds
-- grants on everything in the project, which is not only the payment plans:
-- it is the house, its documents and the door code. An hourly job that sends
-- a push notification had a master key to all of it.
--
-- A signed JWT naming a narrow role would not help from Netlify: the signer
-- would have to hold the JWT secret, and that mints the service role too. So
-- this is a plain Postgres login role, reached through the pooler with its
-- own password. Its grants are exactly what the hourly run does:
--
--   pp_reminder_prefs, pp_bills, pp_people, pp_shares,
--   pp_instalments, pp_payments_in, pp_payments_out    select
--   pp_push_subscriptions                              select, update, delete
--   pp_reminders_sent                                  insert, delete
--   pp_members, everything else                        nothing at all
--
-- `pp_reminders_sent` gets delete because the function releases its claim
-- when a send fails, so the next hour can retry. That is a narrow reason for
-- a wide verb; if the release is ever removed, remove the grant with it.
--
-- Created without LOGIN. Set the password once, by hand, in the SQL editor:
--   alter role pp_reminders with login password '…';
-- Revoke with `alter role pp_reminders nologin`; rotate by setting a new one.
--
-- Applied to the Home project by hand, alongside payment-plans-schema.sql.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pp_reminders') then
    create role pp_reminders nologin noinherit;
  end if;
end $$;

comment on role pp_reminders is
  'The Payment Plans reminder sender''s own login. Reads the ledger and preferences, claims a day in pp_reminders_sent, prunes dead push subscriptions. Nothing else in the project.';

grant usage on schema public to pp_reminders;

grant select on
  public.pp_reminder_prefs, public.pp_bills, public.pp_people, public.pp_shares,
  public.pp_instalments, public.pp_payments_in, public.pp_payments_out
  to pp_reminders;

grant select, update, delete on public.pp_push_subscriptions to pp_reminders;
grant insert, delete         on public.pp_reminders_sent     to pp_reminders;

-- Every pp_ table has RLS on, keyed on the caller's verified email, which
-- this role does not have. A role with no policy sees nothing, so each table
-- it may touch gets a permissive policy for it; the grants are the fence.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pp_reminder_prefs', 'pp_bills', 'pp_people', 'pp_shares',
    'pp_instalments', 'pp_payments_in', 'pp_payments_out',
    'pp_push_subscriptions', 'pp_reminders_sent'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_reminders', t);
    execute format(
      'create policy %I on public.%I for all to pp_reminders using (true) with check (true)',
      t || '_reminders', t);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from pp_reminders;
