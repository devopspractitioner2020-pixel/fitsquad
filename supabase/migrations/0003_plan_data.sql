-- ============================================================
-- Fit Squad — migration 0003: structured plan data
--
-- Run after 0002. Idempotent.
--
-- The model now returns a JSON plan instead of an HTML document, and the app
-- renders it with its own design system. This adds the column to hold it.
--
-- `html` is deliberately KEPT and not dropped: plans generated before this
-- change still live in it, and PlanView falls back to rendering those in the
-- sandboxed iframe as before. Nobody loses a plan they already have. Once
-- every user has regenerated, `html` can be dropped in a later migration.
-- ============================================================

alter table public.plans add column if not exists data jsonb;

-- A ready plan must actually contain something renderable — either the new
-- structured data or the legacy HTML. This is the constraint that would have
-- caught a plan being marked ready with an empty body.
alter table public.plans drop constraint if exists plans_ready_has_content;
alter table public.plans add constraint plans_ready_has_content
  check (status <> 'ready' or data is not null or html is not null);

comment on column public.plans.data is
  'Structured plan (schema.ts PLAN_SCHEMA) plus a `numbers` object computed '
  'server-side by nutrition.ts. Rendered by src/components/PlanDocument.jsx.';
comment on column public.plans.html is
  'LEGACY: model-authored HTML from before the structured-output rewrite. '
  'Read-only; rendered in a sandboxed iframe. Drop once all plans have data.';
