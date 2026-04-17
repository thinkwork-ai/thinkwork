-- Promote `metadata.external.externalTaskId` to a first-class column.
--
-- Background: this id is the hot lookup key for every inbound webhook
-- (correlation + idempotency), and is used by the mobile Tasks list
-- and the `ensureExternalTaskThread` upsert. A JSONB-expression index
-- was the wrong shape. We keep the rest of `metadata.external` in
-- JSONB (provider, connectionId, latestEnvelope) since those aren't
-- hot keys.

ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "external_task_id" text;--> statement-breakpoint

-- Backfill from existing rows.
UPDATE "threads"
   SET "external_task_id" = metadata -> 'external' ->> 'externalTaskId'
 WHERE (metadata -> 'external' ->> 'externalTaskId') IS NOT NULL
   AND "external_task_id" IS NULL;--> statement-breakpoint

-- Collapse duplicate rows that accumulated before the in-process
-- stamping fix (chat-agent-invoke). Keeps the earliest row per
-- (tenant_id, external_task_id) group, deletes the rest. Necessary
-- prerequisite for the unique index below.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, external_task_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM "threads"
   WHERE external_task_id IS NOT NULL
)
DELETE FROM "threads"
 WHERE id IN (SELECT id FROM dupes WHERE rn > 1);--> statement-breakpoint

-- Drop the old JSONB-expression unique index from migration 0007 (if
-- it was created — the partial index may have failed on deploy if
-- dupes were present).
DROP INDEX IF EXISTS "threads_tenant_external_task_id_unique";--> statement-breakpoint

-- Defensive unique index on the new column. Partial so pre-sync
-- threads (NULL external_task_id) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "threads_tenant_external_task_id_unique"
    ON "threads" ("tenant_id", "external_task_id")
 WHERE external_task_id IS NOT NULL;
