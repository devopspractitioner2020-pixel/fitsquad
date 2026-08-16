-- ============================================================
-- Fit Squad — migration 0017: "6pm" means six in the evening
--
-- Run after 0016. Idempotent. Nothing else changes.
--
-- The recap was gated on Sunday **18:00 UTC**, which is 8pm in Stuttgart and
-- 1pm in Lima. It was nobody's six o'clock. The squad's evening is Berlin's,
-- so that is what the gate says now — and being a named zone rather than a
-- fixed offset, it stays at 18:00 local on both sides of the clock change
-- instead of drifting by an hour for half the year.
--
-- Moving the gate BACKWARDS (16:00 UTC in summer, 17:00 in winter) only ever
-- opens a week earlier than it used to, so no recap that was readable
-- yesterday becomes unreadable today.
--
-- NOTE ON THE WEEK ITSELF: `week_start()` is still Monday 00:00 UTC and is
-- deliberately left alone — it is shared with the weight chart in
-- src/lib/weight.js, and three definitions of "this week" is how a chart and
-- a recap end up disagreeing. One consequence worth knowing: the week's
-- window runs to Sunday 24:00 UTC, which is after the recap opens, so a post
-- logged late on Sunday night joins a recap somebody may already have
-- watched. That was true before this migration and is not made worse by it.
-- ============================================================

-- NOTE: this REPLACES recap_available_at() from 0012_edit_and_recap.sql.
-- `create or replace` means the last one to run wins — re-running 0012 puts
-- the gate back on UTC. Finish with this file if you ever do.
--
-- `stable` rather than `immutable`: converting a wall-clock time through a
-- named zone depends on the time-zone database, which is data, not
-- arithmetic. Postgres will not let it be immutable, and squad_recap() is
-- itself stable, so nothing downstream cares.
create or replace function public.recap_available_at(wk date)
returns timestamptz
language sql
stable
as $$
  select ((wk + 6) + time '18:00') at time zone 'Europe/Berlin';
$$;

revoke all on function public.recap_available_at(date) from public, anon;
grant execute on function public.recap_available_at(date) to authenticated;
