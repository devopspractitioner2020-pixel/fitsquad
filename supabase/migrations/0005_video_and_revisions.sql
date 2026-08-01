-- ============================================================
-- Fit Squad — migration 0005: video embeds + saved intake drafts
--
-- Run after 0004. Idempotent.
-- ============================================================

-- ---------- VIDEO EMBEDS ON POSTS ----------
-- We store only the LINK — never the video file. The feed points an iframe at
-- the platform's own player, so the video streams from their servers and the
-- creator keeps the view and the attribution.
alter table public.posts add column if not exists video_url text;

-- Same scheme guard as photo_url: this value ends up in an iframe src, so a
-- javascript: or data: URL must never be storable.
alter table public.posts drop constraint if exists posts_video_url_scheme;
alter table public.posts add constraint posts_video_url_scheme
  check (video_url is null or video_url ~ '^https://');

comment on column public.posts.video_url is
  'Canonical TikTok / Instagram Reel / YouTube link. Embedded via the '
  'platform''s own player — no video file is ever downloaded or stored.';


-- ---------- INTAKE DRAFTS ACTUALLY LOAD ----------
-- `intakes` has been written on every save since day one and read by nothing,
-- so "Save intake" appeared to discard the form. The read is now wired up in
-- the app; this just keeps updated_at honest so the newest draft wins.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists intakes_touch_updated_at on public.intakes;
create trigger intakes_touch_updated_at
  before update on public.intakes
  for each row execute function public.touch_updated_at();


-- ---------- THE FIRST-PLAN REVISION BUDGET ----------
-- `refinements_used` now counts every revision of the first plan, whether the
-- user tweaked the wording or changed their intake and regenerated from
-- scratch. One budget, spendable either way. The 7-day cooldown does not
-- apply until it is spent.
--
-- A regeneration inside that window creates a NEW row that inherits
-- is_first_plan = true and the incremented counter, which is what lets the
-- budget survive across rows.
comment on column public.plans.refinements_used is
  'Revisions used against the first-plan allowance of 3. Counts both tweaks '
  '(same row, new HTML) and full regenerations (new row, counter carried '
  'forward). The 7-day cooldown starts once this reaches 3.';

comment on column public.plans.is_first_plan is
  'True for the initial plan and for any regeneration made while the '
  'first-plan revision budget still had room.';

alter table public.plans drop constraint if exists plans_refinements_sane;
alter table public.plans add constraint plans_refinements_sane
  check (refinements_used >= 0 and refinements_used <= 3);
