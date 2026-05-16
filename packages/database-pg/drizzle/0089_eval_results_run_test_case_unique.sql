-- Hand-rolled migration: per-case eval result idempotency
--
-- U3 moves eval execution from one sequential Lambda to per-case SQS workers.
-- Standard SQS is at-least-once, so duplicate delivery must converge on a
-- single eval_results row for a given (run_id, test_case_id).
--
-- creates: public.uq_eval_results_run_test_case

CREATE UNIQUE INDEX IF NOT EXISTS "uq_eval_results_run_test_case"
ON "eval_results" ("run_id", "test_case_id");
