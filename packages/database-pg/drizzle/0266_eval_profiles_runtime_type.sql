-- creates-column: public.eval_profiles.runtime_type
-- creates-constraint: public.eval_profiles.eval_profiles_runtime_type_check

ALTER TABLE public.eval_profiles
  ADD COLUMN IF NOT EXISTS runtime_type text NOT NULL DEFAULT 'pi';

ALTER TABLE public.eval_profiles
  DROP CONSTRAINT IF EXISTS eval_profiles_runtime_type_check;

ALTER TABLE public.eval_profiles
  ADD CONSTRAINT eval_profiles_runtime_type_check
  CHECK (runtime_type IN ('pi', 'agentcore'));
