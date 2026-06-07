-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0153_message_mentions_agent_profile.sql
-- creates-constraint: public.message_mentions.message_mentions_target_type_allowed

ALTER TABLE public.message_mentions
  DROP CONSTRAINT IF EXISTS message_mentions_target_type_allowed;

ALTER TABLE public.message_mentions
  ADD CONSTRAINT message_mentions_target_type_allowed
  CHECK (target_type IN ('user', 'agent', 'agent_profile'));
