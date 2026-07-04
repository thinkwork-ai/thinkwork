-- Purpose: fold standalone webhooks into Automations (THINK-137 U8, R8). The
-- Settings → Webhooks surface retires; every webhook that a user could
-- manage is henceforth an Automation with a `webhook` trigger. This migration
-- converts each convertible `webhooks` row (target_type agent|routine, NOT
-- connector-created) into an Automation (`agent_loops` + `agent_loop_versions`)
-- and re-points the webhook row at that loop with target_type='automation',
-- PRESERVING the token so inbound URLs keep working.
--
-- Convertible set (matches the plan's agent|routine target scope):
--   target_type IN ('agent','routine')
--   AND connect_provider_id IS NULL   -- connector-created rows are NOT user-
--                                        managed webhooks; they stay untouched
--   AND agent_loop_id IS NULL         -- not already an Automation
--   AND target_type <> 'automation'   -- (redundant with the IN, kept explicit)
--
-- Left UNTOUCHED (deliberately):
--   * target_type='task' rows (external-task connector webhooks) — out of the
--     convertible set; their handler branch survives.
--   * any row with connect_provider_id set (connector-minted) — untouched.
--   * target_type='automation' rows — already new-model.
--
-- Per-target mapping (mirrors targetSpecFromLegacy + saveAgentLoop defaults):
--   * agent target →
--       target_spec {kind:'agent_thread', agentThread:{instructions:<prompt or
--         default>, workerId:<agent_id>, workerType:'agent',
--         threadMode:'new_per_run'}}
--       worker_spec {type:'agent', id:<agent_id>, toolHints:[], config:{}}
--   * routine target →
--       target_spec {kind:'routine', routine:{routineId:<routine_id>}}
--       worker_spec points at the tenant's platform-default agent (worker_spec
--         is NOT NULL but is never read for a routine-kind dispatch; the
--         placeholder keeps the column shape valid for later re-saves).
--   The NOT-NULL legacy spec columns (trigger/goal/worker/judge/loop) get the
--   SAME fixed defaults saveAgentLoop writes: judge self_check, loop_policy
--   {maxIterations:1, failBehavior:'return_blocker', escalateOnFailure:false},
--   trigger {family:'webhook', enabled:true, config:{}}. evidence_policy uses
--   its column default.
--
-- run_as_user_id CHOICE: left NULL (system identity). webhooks.created_by_id is
-- untyped `text` (system|user via created_by_type) and is NOT a users FK, so it
-- cannot be trusted as a run-as identity. A NULL run_as_user_id means the run
-- acts as the system identity — exactly the pre-migration behavior, where the
-- agent branch enqueued wakeups with requested_by_actor_type='system'.
--
-- NULL-space agent rows (none on dev; written for customer stages): an
-- agent_thread automation needs a home Space (R4). When the source webhook has
-- no space_id, the Automation is created DISABLED (agent_loops.enabled=false),
-- the webhook row stays disabled, and a deduplicated inbox item
-- (type='automation_needs_space', entity_type='agent_loop', entity_id=<loop>)
-- is filed so an operator assigns a Space and re-enables. A disabled loop makes
-- the inbound token resolve to a dispatcher skip (agent_loop_disabled →
-- HTTP 200 "ignored"), never an error. Routine targets are headless and never
-- need a Space, so they convert enabled regardless.
-- INBOX CHOICE: a new explicit `automation_needs_space` type (over reusing a
-- headless-failure shape) — it names the exact operator action and carries the
-- loop id as entity_id for the deep link.
--
-- Idempotent: only webhooks in the convertible set are processed, and
-- conversion sets webhooks.agent_loop_id + target_type='automation', which drops
-- the row out of the set — a re-run is a no-op. The inbox insert is guarded by
-- NOT EXISTS on (tenant_id, type, entity_id). The drift-marker VIEW is CREATE OR
-- REPLACE. Safe to re-run. dev converts exactly ONE row (the agent webhook with
-- a Space); customer stages convert 0.
--
-- Pure SQL (no psql vars). Hand-rolled per convention (0210/0211 precedent):
-- advisory lock, pre-flight guards, DO-block loop, drift-marker view.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0212_fold_webhooks_into_automations.sql
--
-- creates: public.view_webhooks_folded_into_automations

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('think137_fold_webhooks_into_automations_0212'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.webhooks') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.webhooks does not exist';
  END IF;
  IF to_regclass('public.agent_loops') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loops does not exist';
  END IF;
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
  IF to_regclass('public.inbox_items') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.inbox_items does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks'
      AND column_name = 'agent_loop_id'
  ) THEN
    RAISE EXCEPTION 'pre-flight: public.webhooks.agent_loop_id missing (apply 0210 first)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_loop_versions'
      AND column_name = 'target_spec'
  ) THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions.target_spec missing (apply 0210 first)';
  END IF;
END $$;

DO $$
DECLARE
  w               RECORD;
  v_loop_id       uuid;
  v_version_id    uuid;
  v_slug          text;
  v_target_kind   text;
  v_instructions  text;
  v_has_space     boolean;
  v_loop_enabled  boolean;
  v_worker_id     uuid;
  v_target_spec   jsonb;
  v_goal_spec     jsonb;
  v_worker_spec   jsonb;
BEGIN
  FOR w IN
    SELECT *
    FROM public.webhooks
    WHERE target_type IN ('agent', 'routine')
      AND connect_provider_id IS NULL
      AND agent_loop_id IS NULL
      AND target_type <> 'automation'
    ORDER BY created_at
  LOOP
    v_target_kind := CASE WHEN w.target_type = 'routine' THEN 'routine' ELSE 'agent_thread' END;
    v_has_space := w.space_id IS NOT NULL;

    -- agent_thread automations need a Space (R4). No Space ⇒ create disabled +
    -- file an operator inbox item. Routine targets are headless; always enabled
    -- to the webhook's own enabled flag.
    IF v_target_kind = 'agent_thread' AND NOT v_has_space THEN
      v_loop_enabled := false;
    ELSE
      v_loop_enabled := w.enabled;
    END IF;

    -- Unique slug: slugify(name) + short webhook-id suffix so the
    -- (tenant_id, slug) unique index never collides across converted rows.
    v_slug := regexp_replace(lower(coalesce(w.name, 'webhook')), '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
    v_slug := left(nullif(v_slug, ''), 60);
    v_slug := coalesce(v_slug, 'webhook') || '-' || left(replace(w.id::text, '-', ''), 8);

    v_instructions := coalesce(
      nullif(btrim(w.prompt), ''),
      'Handle the incoming webhook payload and complete the requested work.'
    );

    IF v_target_kind = 'agent_thread' THEN
      v_worker_id := w.agent_id;
      v_worker_spec := jsonb_build_object(
        'type', 'agent',
        'id', w.agent_id,
        'toolHints', '[]'::jsonb,
        'config', '{}'::jsonb
      );
      v_goal_spec := jsonb_build_object(
        'objective', v_instructions,
        'completionCriteria', '[]'::jsonb
      );
      v_target_spec := jsonb_build_object(
        'kind', 'agent_thread',
        'agentThread', jsonb_build_object(
          'instructions', v_instructions,
          'workerId', w.agent_id,
          'workerType', 'agent',
          'threadMode', 'new_per_run'
        )
      );
    ELSE
      -- routine target — worker_spec is unread for routine dispatch but the
      -- column is NOT NULL; point it at a real platform-default agent when one
      -- exists so a later re-save re-normalizes cleanly.
      v_worker_id := (
        SELECT a.id FROM public.agents a
        WHERE a.tenant_id = w.tenant_id AND a.type = 'agent'
        ORDER BY (a.is_platform_default) DESC NULLS LAST, a.created_at
        LIMIT 1
      );
      v_worker_spec := jsonb_build_object(
        'type', 'agent',
        'id', coalesce(v_worker_id, '00000000-0000-0000-0000-000000000000'::uuid),
        'toolHints', '[]'::jsonb,
        'config', '{}'::jsonb
      );
      v_goal_spec := jsonb_build_object(
        'objective', coalesce(nullif(btrim(w.name), ''), 'Webhook routine'),
        'completionCriteria', '[]'::jsonb
      );
      v_target_spec := jsonb_build_object(
        'kind', 'routine',
        'routine', jsonb_build_object('routineId', w.routine_id)
      );
    END IF;

    INSERT INTO public.agent_loops (
      tenant_id, name, slug, description, lifecycle_status, enabled,
      space_id, run_as_user_id, primary_trigger_family
    )
    VALUES (
      w.tenant_id,
      coalesce(nullif(btrim(w.name), ''), 'Webhook automation'),
      v_slug,
      w.description,
      'active',
      v_loop_enabled,
      w.space_id,
      NULL,          -- run_as_user_id: system identity (see header)
      'webhook'
    )
    RETURNING id INTO v_loop_id;

    INSERT INTO public.agent_loop_versions (
      tenant_id, agent_loop_id, version_number, version_status,
      trigger_spec, goal_spec, worker_spec, judge_spec, loop_policy,
      target_spec, created_by_actor_type, published_at
    )
    VALUES (
      w.tenant_id,
      v_loop_id,
      1,
      'active',
      jsonb_build_object('family', 'webhook', 'enabled', true, 'config', '{}'::jsonb),
      v_goal_spec,
      v_worker_spec,
      jsonb_build_object('mode', 'self_check', 'criteria', '[]'::jsonb, 'config', '{}'::jsonb),
      jsonb_build_object('maxIterations', 1, 'failBehavior', 'return_blocker', 'escalateOnFailure', false),
      v_target_spec,
      'system',
      now()
    )
    RETURNING id INTO v_version_id;

    UPDATE public.agent_loops
    SET current_version_id = v_version_id,
        current_version_number = 1,
        updated_at = now()
    WHERE id = v_loop_id;

    -- Re-point the webhook at the new Automation. Token PRESERVED; enabled
    -- mirrors the loop (disabled for the NULL-space agent case).
    UPDATE public.webhooks
    SET target_type = 'automation',
        agent_loop_id = v_loop_id,
        enabled = v_loop_enabled,
        updated_at = now()
    WHERE id = w.id;

    -- NULL-space agent row: file a deduplicated operator inbox item.
    IF v_target_kind = 'agent_thread' AND NOT v_has_space THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.inbox_items i
        WHERE i.tenant_id = w.tenant_id
          AND i.type = 'automation_needs_space'
          AND i.entity_type = 'agent_loop'
          AND i.entity_id = v_loop_id
      ) THEN
        INSERT INTO public.inbox_items (
          tenant_id, requester_type, type, status, title, description,
          entity_type, entity_id, config
        )
        VALUES (
          w.tenant_id,
          'system',
          'automation_needs_space',
          'pending',
          'Automation needs a Space',
          format(
            'The webhook "%s" became an Automation but has no Space, so it is disabled. Assign a Space and re-enable it to accept inbound deliveries.',
            coalesce(nullif(btrim(w.name), ''), 'webhook')
          ),
          'agent_loop',
          v_loop_id,
          jsonb_build_object('webhookId', w.id, 'source', 'think137_u8_fold')
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Drift marker + summary. Presence proves the fold transaction committed.
CREATE OR REPLACE VIEW public.view_webhooks_folded_into_automations AS
SELECT
  COUNT(*) FILTER (
    WHERE target_type = 'automation' AND agent_loop_id IS NOT NULL
  )::int AS automation_webhooks,
  COUNT(*) FILTER (
    WHERE target_type IN ('agent', 'routine')
      AND connect_provider_id IS NULL
      AND agent_loop_id IS NULL
  )::int AS unconverted_convertible_webhooks,
  COUNT(*) FILTER (WHERE connect_provider_id IS NOT NULL)::int AS connector_webhooks,
  COUNT(*) FILTER (WHERE target_type = 'task')::int AS task_webhooks,
  now() AS checked_at
FROM public.webhooks;

COMMENT ON VIEW public.view_webhooks_folded_into_automations IS
  'Drift marker and summary for 0212_fold_webhooks_into_automations.sql (THINK-137 U8).';

COMMIT;
