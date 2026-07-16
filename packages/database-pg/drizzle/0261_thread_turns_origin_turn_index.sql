-- THINK-307 KTD4: the retry dispatcher's successor-turn guard, THINK-308's
-- finalize reconciliation, and THINK-309's recovery resolver all look up
-- thread_turns by origin_turn_id; no index covers that column today.
-- Additive — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0261_thread_turns_origin_turn_index.sql
-- creates: public.idx_thread_turns_origin_turn

CREATE INDEX IF NOT EXISTS idx_thread_turns_origin_turn
  ON public.thread_turns (origin_turn_id);
