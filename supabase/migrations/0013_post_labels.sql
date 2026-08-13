-- ============================================================
-- Fit Squad — migration 0013: labels that describe the post
--
-- Run after 0012. Idempotent.
--
-- THE BUG
--
-- The line under the author's name was hardcoded in the card:
--
--   kind === 'workout' ? 'Strength' : kind === 'meal' ? 'Healthy Meal' : 'Tip'
--
-- It never looked at the post. So a cheat meal — a post whose whole point is
-- that it was not a healthy one, carrying a pink "cheat 😈" pill two lines
-- below — announced itself as a **Healthy Meal**. And every workout claimed
-- to be Strength whether it was a 10k run, a football match or a yoga class,
-- because there was nowhere to say otherwise.
--
-- Two different mistakes with the same cause: the label was a constant when
-- it should have been data.
--
--   workout_type  what kind of training it was — the thing there was no way
--                 to choose.
--   meal_tags     what else is true about a meal. `is_healthy` is a single
--                 bit and meals are not one bit: a meal can be home-cooked,
--                 high in protein, eaten out, none of those, or several.
--
-- `is_healthy` and `is_cheat` STAY. They are what the leaderboard counts and
-- what the weekly recap reports, and quietly changing their meaning would
-- rewrite scores that people have already seen. Tags sit alongside them and
-- describe; the two booleans still score.
-- ============================================================

alter table public.posts
  add column if not exists workout_type text,
  add column if not exists meal_tags text[] not null default '{}';

-- Constrained, not free text. An open column here means a typo becomes a new
-- category, and the feed ends up rendering 'Strenght' next to 'strength'.
alter table public.posts drop constraint if exists posts_workout_type_valid;
alter table public.posts add constraint posts_workout_type_valid
  check (
    workout_type is null
    or workout_type in ('strength', 'cardio', 'sport', 'mobility', 'class', 'other')
  );

alter table public.posts drop constraint if exists posts_meal_tags_valid;
alter table public.posts add constraint posts_meal_tags_valid
  check (
    meal_tags <@ array['high-protein', 'home-cooked', 'eating-out', 'veggie', 'quick']::text[]
  );

-- A tag on a workout, or a workout_type on a meal, is a rendering surprise
-- waiting to happen.
alter table public.posts drop constraint if exists posts_labels_match_kind;
alter table public.posts add constraint posts_labels_match_kind
  check (
    (kind = 'workout' or workout_type is null)
    and (kind = 'meal' or cardinality(meal_tags) = 0)
  );

comment on column public.posts.workout_type is
  'strength | cardio | sport | mobility | class | other. Null on older posts, '
  'which the app renders as a plain "Workout" rather than guessing.';

comment on column public.posts.meal_tags is
  'Descriptive labels. Deliberately NOT is_healthy — that one bit is what the '
  'leaderboard counts, and it stays.';

-- NOT BACKFILLED, on purpose. Every workout logged before today was labelled
-- "Strength" by the card, but that was the bug, not a fact — some of those
-- were runs. Leaving them null means they read as "Workout", which is the
-- honest thing to say about a post nobody was ever asked to categorise.
