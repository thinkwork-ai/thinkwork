-- creates-column: public.eval_runs.requester_user_id
-- creates: public.idx_eval_runs_requester_user_id
-- Exact human principal used to resolve per-user identity and capabilities for
-- production-shaped AgentCore Harness evaluation turns. Nullable preserves
-- legacy Pi evaluation rows; Harness dispatch fails closed when it is absent.

ALTER TABLE public.eval_runs
  ADD COLUMN IF NOT EXISTS requester_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'eval_runs_requester_user_id_users_id_fk'
      AND conrelid = 'public.eval_runs'::regclass
  ) THEN
    ALTER TABLE public.eval_runs
      ADD CONSTRAINT eval_runs_requester_user_id_users_id_fk
      FOREIGN KEY (requester_user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_eval_runs_requester_user_id
  ON public.eval_runs (requester_user_id);
