-- 0131_drop_computer_tables.sql
-- drops: public.computer_events
-- drops: public.computer_tasks
-- drops: public.computer_assignments
-- drops: public.computer_snapshots
-- drops: public.computers
--
-- Kill the legacy Computer feature. All product surfaces (admin, Spaces,
-- mobile, CLI), Lambda handlers (computer-runtime, computer-manager,
-- computer-runtime-reconciler, computer-terminal-start, slack-dispatch,
-- workspace-files-efs, migrate-agents-to-computers), GraphQL resolvers,
-- and Terraform modules for the Computer concept are removed in this
-- same PR. After this migration applies, the 5 tables drop and ~2.6 GB
-- of dead data is reclaimed.
--
-- Order: child tables first to satisfy FK chains.
--   computer_events.task_id → computer_tasks.id
--   computer_tasks.computer_id → computers.id
--   computer_assignments.computer_id → computers.id
--   computer_snapshots.computer_id → computers.id
--
-- Apply AFTER merge + deploy of this PR so the live Lambda functions
-- have already shipped without computer_* reads/writes. Applying before
-- the deploy will crash chat-agent, scheduled jobs, and admin queries
-- with PG 42P01 (relation does not exist).

DROP TABLE IF EXISTS public.computer_events CASCADE;
DROP TABLE IF EXISTS public.computer_tasks CASCADE;
DROP TABLE IF EXISTS public.computer_assignments CASCADE;
DROP TABLE IF EXISTS public.computer_snapshots CASCADE;
DROP TABLE IF EXISTS public.computers CASCADE;
