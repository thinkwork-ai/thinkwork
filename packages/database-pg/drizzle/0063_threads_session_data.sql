-- Plan §005 U4 — add `threads.session_data jsonb` for Flue's `SessionStore`.
--
-- Hand-rolled (NOT registered in meta/_journal.json — applied via psql in
-- deploy.yml as a pre-Terraform-apply step so the agentcore-flue Lambda
-- never reads/writes a column the schema doesn't have).
--
-- The column is nullable: pre-Flue threads coexist with NULL. Flue's
-- AuroraSessionStore.delete() also sets the column to NULL rather than
-- dropping the thread row, so the post-state is the same as the pre-state
-- whenever the column is empty.
--
-- Marker for db:migrate-manual drift-reporter (see CLAUDE.md "Some
-- drizzle/*.sql files are hand-rolled..."):
-- creates-column: public.threads.session_data

\echo '== plan §005 U4: threads.session_data jsonb column =='

ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS session_data jsonb;

-- No index — Flue keys exclusively on `threads.id` (the PK) plus
-- `tenant_id` (existing `idx_threads_tenant_id`). Adding a GIN/BTREE index
-- on a jsonb column we never query inside is wasted write amplification.
