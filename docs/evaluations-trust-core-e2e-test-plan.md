# Evaluations Trust Core — End-to-End Confirmation Plan

Hand this to an agent (or human) to confirm the Evaluations Trust Core works end-to-end on the **dev** stack. It covers the 14 shipped units (THNK-2): tenant security, honest verdicts, per-tenant datasets, flag→replay→judge, operator override, and the trust dashboard.

The decisive test is **T4 (flag → run → honest judged verdict)** — it exercises the whole loop. If you only run one, run that.

---

## 0. Environment & access

- **Web app:** `http://localhost:5175` — a local Vite build wired to the **deployed dev backend**. Every action hits the real deployed GraphQL / eval-worker / Bedrock judge and the dev Aurora DB. If it's not running:
  ```bash
  cd <repo>/apps/web && cp /Users/ericodom/Projects/thinkwork/apps/web/.env .env
  npx vite --host localhost --port 5175 --strictPort
  ```
  Port 5175 is Cognito-callback-allowlisted, so Google OAuth works.
- **Auth:** sign in via Google as a **tenant operator/admin** (owner or admin role). Some surfaces are operator-gated and stay hidden for members — that gating is itself under test (T1).
- **AWS:** region `us-east-1`, account is the dev stack (`thinkwork-dev-*`). DB connection for read-only state checks:
  ```bash
  export AWS_REGION=us-east-1
  S=$(aws secretsmanager get-secret-value --secret-id thinkwork-dev-db-credentials --query SecretString --output text)
  U=$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['username'])")
  P=$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['password'])")
  export DATABASE_URL="postgresql://$U:$P@thinkwork-dev-db.cluster-cmfgkg8u8sgf.us-east-1.rds.amazonaws.com:5432/thinkwork?sslmode=require"
  ```
  **All DB checks below are read-only `SELECT`s. Do not mutate the dev DB.**
- **Schema preconditions** (confirm migrations 0159–0164 landed):
  ```sql
  SELECT column_name FROM information_schema.columns
   WHERE table_name='eval_runs' AND column_name IN ('errored','scoring_version','summary_scoring_version');
  SELECT column_name FROM information_schema.columns
   WHERE table_name='eval_results' AND column_name IN ('error_cause','override_status','override_reason');
  SELECT to_regclass('public.eval_datasets'), to_regclass('public.eval_replay_tool_allowlist');
  SELECT column_name FROM information_schema.columns
   WHERE table_name='eval_replay_tool_allowlist' AND column_name='mode';
  ```
  Expect every column/table present. If any are missing, the deploy or a hand-rolled migration didn't apply — stop and report.
- **Judge enabled** (the U12 regression — this is the bug that shipped invisibly once):
  ```bash
  aws lambda get-function-configuration --function-name thinkwork-dev-api-eval-worker \
    --query "Environment.Variables.{judge:EVAL_LLM_JUDGE,model:EVAL_JUDGE_MODEL_ID}" --output json
  ```
  Expect `judge: "1"` and a non-empty model id. If `judge` is `None`, the LLM judge is dead and every quality rubric will vacuously pass — fail the whole plan here.

---

## T1 — Tenant security & operator gating

**Goal:** eval surface is tenant-scoped and mutations are operator-gated; the historical cross-tenant hole is closed.

1. As an **operator**, open `http://localhost:5175/settings/evaluations`. Expect the dashboard to load with your tenant's runs only.
2. Confirm operator-only affordances are present: **Start run**, **Datasets**, **Replay Tools**, and per-result **Operator override** controls.
3. (If you can sign in as a non-admin member) repeat — expect the flag-for-eval affordance and the override controls to be **hidden**, and mutations to be rejected server-side.
4. **Programmatic cross-tenant check** (the closed bug): every eval row carries `tenant_id`; confirm the API never returns another tenant's rows. Spot-check that runs/results/datasets in the UI all belong to your tenant. (Resolver-level cross-tenant rejection is covered by the test suite; the UI check confirms scoping holds in practice.)

**Pass:** operator sees the full surface scoped to their tenant; non-admin is gated out; no cross-tenant data appears.

---

## T2 — Baseline red-team dataset seeded

**Goal:** every tenant gets the baseline red-team suite, materialized to S3 with a synced DB index.

1. UI: **Evaluations → Datasets**. Expect a **`baseline-red-team`** dataset (kind: baseline) with a case count in the ~189 range.
2. Open it: cases are grouped/listed with categories (prompt-injection, tool-misuse, data-boundary, safety-scope across agent/computer/skill surfaces).
3. **DB check:**
   ```sql
   SELECT d.slug, d.kind, d.version, count(c.*) AS cases
     FROM eval_datasets d
     LEFT JOIN eval_test_cases c ON c.dataset_id = d.id
    WHERE d.slug='baseline-red-team'
    GROUP BY d.slug, d.kind, d.version;
   ```
   Expect one baseline row with a non-trivial case count.
4. **Trend-history preservation:** re-homed seed rows keep `source='yaml-seed'`:
   ```sql
   SELECT count(*) FROM eval_test_cases WHERE source='yaml-seed' AND dataset_id IS NOT NULL;
   ```
   Expect > 0 (re-home set linkage without changing source).

**Pass:** baseline dataset present in UI + DB with cases linked and `source` preserved.

---

## T3 — Flag a thread into a custom dataset

**Goal:** an operator turns a real bad thread into an eval case with a required resolution target and a self-contained snapshot.

1. Open any thread with a completed agent turn (ideally one where the agent answered a data question, e.g. a CRM lookup).
2. Use **Flag for evaluation** (thread header action, or the per-turn flag icon on a completed turn).
3. In the dialog: pick **New dataset** (name it e.g. `e2e-confirm`), set outcome kind (Quality or Security), and **leave the resolution target blank** → confirm **the save is blocked** (required field). This is acceptance example AE3.
4. Fill the resolution target (e.g. _"This should have been returned as a table"_) and save. Expect a success toast with a link to the dataset, and a completeness note (history / workspace / traces captured).
5. **DB check** — the case exists with provenance, and the required resolution target is stored as an `llm-rubric` inside `assertions` (there is no dedicated column for it):
   ```sql
   SELECT name, category, source, assertions::text FROM eval_test_cases
    WHERE dataset_id = (SELECT id FROM eval_datasets WHERE slug='e2e-confirm');
   ```
   Expect a row with `category='flagged-thread'`, and the resolution target you typed surfaced in `assertions` as an `llm-rubric` entry.

**Pass:** flagging requires a resolution target, creates a `flagged-thread` case with provenance, and the case is visible in the new dataset.

---

## T4 — Flag → run → honest judged verdict (the core loop) ⭐

**Goal:** the whole trust loop. A flagged thread replays against the current agent with read-only tools auto-allowed, and the LLM judge scores the **real** output — not a vacuous pass.

1. Use the dataset from T3 (or flag a CRM-style thread fresh: a turn that asked for data, e.g. _"what are the last 5 opportunities in the CRM?"_, with resolution target _"This should have been in a table"_).
2. **Run the dataset** (Run button on the dataset, or Start run → pick the dataset).
3. Open the completed run → the case drill-in. Inspect **Actual Output**:
   - The agent should **actually fetch the data** (read-shaped MCP tools like `opportunities_list` auto-allow on replay since U14) — the output should contain real opportunities, not _"I don't have access to the CRM MCP tools."_
   - If the output is still a tool-absence apology, check **Evaluations → Replay Tools**: the read tool should show **Auto-allowed**. If it shows blocked, the heuristic mis-classified it — note the tool name (a one-time force-allow override is the fix).
4. **Verdict honesty (the U12 regression):** the verdict must reflect the actual output, NOT a blanket `pass / 1.00`:
   - Output is a proper table → **pass**.
   - Output is prose / not a table → **fail** with the judge's reasoning shown (rubric "what was checked" is displayed).
   - Judge itself errored → **error / evaluator_error** (never a silent pass, never a behavioral fail).
5. **DB confirmation** the real judge ran (not the vacuous heuristic):
   ```sql
   SELECT status, error_cause, score, left(actual_output, 60) AS output
     FROM eval_results
    WHERE run_id = (SELECT id FROM eval_runs ORDER BY created_at DESC LIMIT 1);
   ```
   A non-table output scoring `pass` with `score=1.0` and no error_cause is the **failure signature of the old bug** — if you see that on a clearly-non-table output, the judge isn't running.

**Pass:** the agent fetches data via auto-allowed read tools, and the verdict matches reality (table→pass, non-table→fail-with-reasoning), never a blanket pass.

---

## T5 — Errors never pollute the score

**Goal:** infra failures (timeout/throttle/judge-error) are recorded as `error` with a cause and excluded from the pass rate; all-error/zero-case runs show "No score," never 0%.

1. In any completed run with mixed outcomes, open the drill-in. Confirm the **verdict filter chips** split **Passed / Behavioral failures / Errors**, and that error rows render by **cause** (Timeout / Throttled / Judge error / Reconciler / Infrastructure) — **never with a score**.
2. The run header / dashboard shows an **errored count** beside the pass rate; the pass rate denominator excludes errors.
3. **DB check** the denominator math:
   ```sql
   SELECT passed, failed, errored, pass_rate, scoring_version
     FROM eval_runs WHERE status='completed' ORDER BY created_at DESC LIMIT 5;
   ```
   Expect `pass_rate ≈ passed/(passed+failed)` (errors NOT in the denominator); a run with 0 passed+failed has `pass_rate` NULL (renders "No score").
4. Dashboard: any run with NULL pass_rate shows **"No score"** (not 0%); pre-cutover runs (NULL `scoring_version`) show a **legacy** badge and are excluded from the trend average.

**Pass:** errors are grouped separately with causes and excluded from the score; "No score" and "legacy" render correctly.

---

## T6 — Operator verdict override

**Goal:** an operator can overturn a verdict with a required reason; the original judge verdict is preserved and the run score recomputes.

1. In a result drill-in, use **Operator override**: try to submit with an empty reason → blocked (reason required).
2. Enter a reason and **Mark pass** (or **Mark fail**) to flip a verdict. Expect: the displayed verdict updates, the original judge verdict remains shown, and the run's pass rate recomputes — **without a page reload** (subscription-driven refetch).
3. **DB check** — override is a separate field, judge verdict untouched:
   ```sql
   SELECT status, override_status, overridden_by, override_reason
     FROM eval_results WHERE override_status IS NOT NULL ORDER BY created_at DESC LIMIT 3;
   ```
   Expect `status` (original judge verdict) intact alongside a populated `override_status` + `overridden_by` (server-derived actor) + `override_reason`.

**Pass:** override requires a reason, recomputes the score live, and preserves the original verdict as an audit trail.

---

## T7 — Run pinning & comparison

**Goal:** a run executes the dataset version it was launched with; comparing runs shows per-case transitions.

1. Launch a dataset run. While it's running, **edit a case** in that dataset (toggle enabled, or change a case). Confirm the **in-flight run is unaffected** — it executes the launch-time snapshot, and its results reference the pinned version. **Use a deliberately multi-case dataset for this step** (the baseline `baseline-red-team` suite, or a multi-case custom dataset) — a one-case dataset completes in seconds and finishes before you can make the edit, so the mid-run-edit check isn't observable.
2. After a fix-and-rerun cycle (run the same dataset twice with a change to the agent or case in between), use **Compare with previous run** on the dataset-pinned run. Expect per-case transitions labeled **fail→pass / pass→fail / new error** (acceptance example AE4).

**Pass:** mid-run edits don't change a running run; comparison surfaces case-level transitions.

---

## T8 — Replay write-safety (read-only default)

**Goal:** replay auto-allows read-shaped MCP tools and blocks writes by name; the email/web side-effect kill-list always holds.

1. **Evaluations → Replay Tools.** Expect the header to read that read-only tools already run automatically; each discovered tool shows a disposition: read-shaped (`list/get/search/...`) = **Auto-allowed**, write-shaped (`create/update/delete/send/...`) = **Blocked (write)**.
2. Confirm there is **no required setup** — the empty/default state communicates "nothing to configure."
3. (Optional) Add a **force-block** override on a read tool, re-run the flagged case, and confirm that tool no longer runs (output reflects its absence). Remove the override after.
4. **Safety invariant (do not bypass):** outbound side-effect tools — email send, web search/extract — are stripped from every replay regardless of overrides. A replay must never send email or hit the live web. (Covered by the suite; spot-confirm no such tool appears as auto-allowed.)

**Pass:** read tools auto-allow with zero setup, write tools are blocked by default, side-effect tools are never available on replay.

---

## Programmatic-only smoke (no browser)

If running without a browser, this subset confirms the backbone via DB + AWS:

- Migrations present (§0 schema preconditions) — **must pass**.
- Judge enabled (§0 judge check) — **must pass**.
- Baseline dataset seeded (T2 SQL).
- Latest run's results show real judged verdicts with causes, not blanket 1.0 on non-table output (T4/T5 SQL).
- Overrides preserve original verdict (T6 SQL).

---

## Reporting

For each test: PASS / FAIL + evidence (screenshot or SQL output). Flag especially:

- **T4 vacuous-pass signature** (non-table output scoring pass/1.0) → judge regression, highest severity.
- **T5 denominator** (errors counted in pass rate) → trust regression.
- **T8** any side-effect tool auto-allowed on replay → safety regression.

Known non-eval issue to ignore: the MCP server registry shows duplicate entries (`lastmile-crm` vs `lastmile--crm`, etc.) — a separate registry-cleanup item, not an eval defect.

---

## Execution notes — 2026-06-13 local dev run

Runner: Codex, using the local web server on `http://localhost:5175` from `.claude/worktrees/eval-trust-core/apps/web`, backed by the deployed `dev` stack.

### Results

- **Preflight: PASS.** Migrations 0159-0164 preconditions were present (`eval_runs.errored`, `scoring_version`, `summary_scoring_version`; `eval_results.error_cause`, `override_status`, `override_reason`; `eval_datasets`; `eval_replay_tool_allowlist.mode`). Eval worker config had `EVAL_LLM_JUDGE=1` and model `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- **T1: PARTIAL PASS.** Operator/admin surface loaded and showed `Run evaluation`, `Datasets`, `Replay tools`, and override controls on a result. Non-admin/member account coverage was not executed in this pass.
- **T2: PASS.** `baseline-red-team` rendered in the Datasets UI as `baseline`, `v1`, `189` cases. DB confirmed `baseline-red-team | baseline | 1 | 189`, and `source='yaml-seed'` linked case count was `189`. Dataset detail showed red-team categories including data-boundary, safety-scope, tool-misuse, and prompt-injection.
- **T3: PASS.** Created CRM thread `/threads/8bd81893-75c4-4583-9db8-2fa9d45314cf` in `Chats`. Empty resolution target disabled save. Flagged the completed turn into custom dataset `e2e-confirm`; DB row had `category='flagged-thread'` with LLM rubric stored in `assertions`.
- **T4: PASS.** Run `82883ab9-a336-4c98-859d-ceac5466ae41` replayed the flagged CRM turn and fetched real opportunity data through read-shaped CRM tools. Judge scored the prose output as `fail`, `score=0.1500`, `error_cause=NULL`; no vacuous pass signature.
- **T5: PASS.** Dashboard and DB split errors from behavioral failures. Baseline run `802278cf-0815-4888-95a4-07c76c1c54a8` showed `100 passed / 21 failed / 68 errored`, `pass_rate=0.8264`, matching `100/(100+21)`. Recent error causes included `infra_other` and `timeout`.
- **T6: PASS.** Override controls were disabled until a reason was entered. Marking the result pass recomputed run `82883ab9-a336-4c98-859d-ceac5466ae41` to `1 passed / 0 failed`, `pass_rate=1.0000`; DB preserved original `status='fail'` with `override_status='pass'`, server-derived `overridden_by`, and the override reason.
- **T7: PARTIAL PASS.** Run pinning was confirmed in DB via `dataset_version=2` and `pinned_case_ids={flagged-8bd81893-7ccfef66}`. A second run `437c9970-6e85-477b-9405-a0e815bfc0e1` compared against previous run `82883ab9` and the UI showed `pass -> fail`. The mid-run edit check was not meaningful because the one-case dataset completed in seconds.
- **T8: PASS with feedback.** Replay Tools explained zero-setup read-only replay. `opportunities_list`, `opportunities_get`, `leads_list`, and `leads_get` were Auto-allowed; create/update/delete/send-shaped tools were Blocked (write). No outbound email/web side-effect tool appeared auto-allowed.

### Feedback

- ~~Direct/hard navigation to nested evaluation routes such as `/settings/evaluations`, `/settings/evaluations/datasets`, `/settings/evaluations/datasets/baseline-red-team`, and `/settings/evaluations/<runId>` intermittently redirected/rendered `/settings/general`. Entering through the Settings side nav made the routes work.~~ **RESOLVED (U15 Finding 1):** root cause was `TenantContext` resolving `role=null` during the pre-hydration window (auth transiently `isAuthenticated=false` on hard load), so `OperatorGuard` redirected operators to `/settings/general` before auth settled. The provider now keeps `roleResolved=false` while auth is still loading and only resolves once auth definitively settles. Direct-URL navigation to nested eval routes now works — side-nav entry is no longer required.
- Dataset table name links had a zero-width clickable box in automation (`getBoundingClientRect().width === 0` for the baseline link). A coordinate click on the visible text opened the detail page. This is worth checking visually/CSS-wise because it may affect keyboard or hit-target accessibility.
- Replay Tools currently classifies some read-like/introspection tools as blocked by name, e.g. `me`, `crm_schema`, and `data_catalog_schema`. This may be intended safety conservatism, but it conflicts slightly with the plan's broad "read-shaped tools auto-allowed" language.
- The test plan's T3 DB snippet only checks `name`, `category`, and `source`; the resolution target now lives inside `eval_test_cases.assertions` as an `llm-rubric`. Consider adding `assertions::text` to the verification query.
- T7's mid-run edit step needs either a deliberately slow/multi-case dataset or a programmatic worker pause; with a one-case dataset it completes too quickly to validate manually.
