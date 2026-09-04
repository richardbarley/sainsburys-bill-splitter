-- Plans reads the suite's members table.
--
-- barley-home migration 0007 creates `suite_members(email, app, role)` and
-- `suite_can(app, write)`, one table and one helper for every app in the
-- suite, and backfills it from `pp_members`. This file repoints Plans' two
-- helpers at it. Same names, same grants, new body: every pp_ policy keeps
-- calling `pp_is_member()` and `pp_is_owner()`, and from here on they answer
-- from suite_members with app = 'plans'.
--
-- Apply to the Home project by hand, AFTER barley-home 0007, which is what
-- creates the function this depends on. Applying it first fails on the
-- missing function, which is the right failure.
--
-- `pp_members` itself stays for now: plans.html and plans-push-send.js still
-- select from it to decide whether to show the no-access screen, and it is
-- what 0007 backfilled from. It goes with the rest of the old lists at
-- checklist item b-drop-old, once those two readers ask suite_members instead.

create or replace function public.pp_is_member() returns boolean
  language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select public.suite_can('plans', false);
$$;

create or replace function public.pp_is_owner() returns boolean
  language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select public.suite_can('plans', true);
$$;

comment on function public.pp_is_member() is
  'True when the caller may open Plans. A wrapper over suite_can(''plans'') since the suite members table arrived.';
comment on function public.pp_is_owner() is
  'True when the caller may write Plans. A wrapper over suite_can(''plans'', true).';

-- The grants are unchanged by create or replace, but stated so the file
-- stands on its own: not callable by anon or PUBLIC, callable by
-- authenticated because the policies need it.
revoke execute on function public.pp_is_member() from public, anon;
revoke execute on function public.pp_is_owner()  from public, anon;
grant  execute on function public.pp_is_member() to authenticated;
grant  execute on function public.pp_is_owner()  to authenticated;
