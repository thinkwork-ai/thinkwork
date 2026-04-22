---
title: "feat: composable-skills hardening + context-mode dispatch (session handoff)"
type: feat
status: active
date: 2026-04-22
---

# Composable-skills hardening + context-mode dispatch (session handoff)

Two PRs to ship, in order. Both target `main`. Work each in its own fresh
worktree off `origin/main` under `.claude/worktrees/<name>`, branch
`<type>/<name>`.

## Context you need before starting

The composable-skills system works end-to-end: `/api/skills/start` → agentcore
Lambda → composition_runner → sub-skill dispatch → `/api/skills/complete` → DB
update. Script sub-skills execute real Python functions.
`scripts/smoke/complete-smoke.sh` PASSes against dev with `status=complete`.
Three doc pages live under
`/concepts/agents/composable-skills/{,authoring,primitives}`. This has all
shipped; don't re-plan it. Recent PRs that are load-bearing background:

- #387 — smoke kit + ON CONFLICT fix
- #389 — `kind=run_skill` dispatch (wires server.py branch + `/api/skills/complete`)
- #396 — script sub-skill dispatch (`execution: script` works)
- #402 — composable-skills docs (overview, authoring, primitives)

Canonical files you'll touch:

- `packages/agentcore-strands/agent-container/run_skill_dispatch.py`
- `packages/agentcore-strands/agent-container/test_server_run_skill.py`
- `packages/agentcore-strands/agent-container/server.py` (PR #2 only — the
  `do_POST` handler's `run_skill` branch)
- `packages/api/src/handlers/skills.ts` (`completeSkillRunService`, ~line 2570)
- `packages/api/src/__tests__/skills-complete-handler.test.ts`
- `packages/lambda/job-trigger.ts` (scope-key emission)
- `packages/database-pg/drizzle/0020_*.sql` (new, PR #1)

Dev-stack facts for empirical verification:

- Tenant id: `0015953e-aa13-4cab-8398-2e70f73dda63`
- eric@thinkwork.ai user id: `4dee701a-c17b-46fe-9f38-a333d4c3fad0`
- Marco agent id: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c`
- API base: `https://ho7oyksms0.execute-api.us-east-1.amazonaws.com`
- `API_AUTH_SECRET=tw-dev-secret` (in `terraform/examples/greenfield/terraform.tfvars`)
- Smoke helper: `scripts/smoke/_env.sh` resolves everything via terraform
  outputs + Secrets Manager. Run `source scripts/smoke/_env.sh` to get
  `API_URL`, `API_AUTH_SECRET`, `DATABASE_URL` set.

## PR #1 — Reliability hardening of the composable-skill pipeline

Six concrete changes. All behavior-preserving except the reconciler.

### Change 1: stuck-`running` reconciler cron

**Problem:** if the agentcore Lambda times out / OOMs / crashes mid-
`run_composition`, `post_skill_run_complete` never fires and
`skill_runs.status` stays at `running` forever. No reconciler exists today.

**Fix:** add a Lambda + EventBridge rule that runs every 5 minutes and
transitions stale rows:

```sql
UPDATE skill_runs
SET status='failed',
    failure_reason='reconciler: stale running row (no terminal writeback within 15 min)',
    finished_at=now(),
    updated_at=now()
WHERE status='running'
  AND started_at < now() - interval '15 minutes';
```

Put the handler at `packages/lambda/skill-runs-reconciler.ts`. Wire it in
`terraform/modules/app/lambda-api/handlers.tf` (or the appropriate module —
grep for `job-schedule-manager` as the pattern for "Lambda + scheduled rate
rule"). Emit a structured CloudWatch log line per reconciled row so it's
alertable.

### Change 2: bounded retry on `post_skill_run_complete`

**Problem:** `run_skill_dispatch.post_skill_run_complete` catches every
exception, logs, and returns — one 15s attempt, no retry. A single Aurora /
API-gateway blip strands the row.

**Fix in `run_skill_dispatch.py`:** wrap the `urllib.request.urlopen` call in
a retry loop:

- 3 attempts, exponential backoff with jitter (e.g. 1s / 3s / 9s ± 0.5s)
- Retry on: any `HTTPError` with status 5xx, `URLError`, `socket.timeout`
- Do NOT retry on: 4xx (especially 400 "invalid transition" — that's
  idempotency; if a prior attempt succeeded server-side, the retry should
  treat 400 as terminal-ok, not as failure)
- Log each attempt with attempt number

Add a Python test asserting: 5xx → retried 3x → eventually raises; 400
"invalid transition" → treated as success (not retried); 200 → one call
only.

### Change 3: HMAC-sign the `/api/skills/complete` body

**Problem:** `completeSkillRunService` accepts `runId` + `tenantId` + `status`
as body fields. The tenant check compares `body.tenantId` to the DB row's
tenantId, which only catches inconsistent envelopes — an attacker holding
`API_AUTH_SECRET` + a runId can flip any tenant's run to any terminal state
and inject attacker-controlled `deliveredArtifactRef`.

**Fix:**

- In `startSkillRunService` (`packages/api/src/handlers/skills.ts`, ~line
  2429), after inserting the row, compute and return an HMAC-SHA256 of
  `runId` using a fresh per-run secret. Store the secret in the DB
  (`skill_runs.completion_hmac_secret` — new nullable text column via a new
  `0020_skill_runs_completion_hmac.sql` hand-rolled migration with
  `-- creates-column: public.skill_runs.completion_hmac_secret` marker per
  repo convention).
- Emit the secret in the `invokeAgentcoreRunSkill` envelope under a new
  `completionHmacSecret` field so the container knows it.
- In `run_skill_dispatch.post_skill_run_complete`, compute
  `hmac.new(secret, runId.encode(), sha256).hexdigest()` and include as
  `X-Skill-Run-Signature: sha256=<hex>` header.
- In `completeSkillRunService`, load the secret from the DB row, recompute
  the expected signature, `crypto.timingSafeEqual` against the header.
  Missing or mismatched → 401. Burn the secret on successful completion
  (set to NULL) so it's single-use.

This keeps `API_AUTH_SECRET` as the gate for *dispatch*, not for
*completion*; a leaked bearer + guessed runId can't forge a completion
because the per-run HMAC secret isn't in the envelope the attacker has.

Add TS unit tests: valid HMAC → 200; wrong HMAC → 401; missing header → 401;
already-terminated row (secret already burned) → 401.

### Change 4: fix TS → Python scope key casing

**Problem:** `startSkillRunService` and `job-trigger.ts` emit envelopes with
`scope: {tenantId, userId, skillId}` (camelCase). `composition_runner.py`'s
`_scope_to_inputs` reads `scope.get('tenant_id')` etc. (snake_case). Every
auto-compound-recall/reflect lookup silently coerces to `""`. Hidden today
because every sub-skill raises before auto_reflect, but it'll bite the
moment any context-mode connector lands.

**Fix:** change the TS side to emit snake_case (it's the Python runtime that
consumes it, and Python convention wins). Update `invokeAgentcoreRunSkill`
in both `packages/api/src/handlers/skills.ts` and
`packages/lambda/job-trigger.ts` to emit `scope: {tenant_id, user_id,
skill_id}`. Add a regression test in `test_server_run_skill.py` asserting
the dispatch path passes through `tenant_id` (not `tenantId`) to
composition_runner's `_scope_to_inputs`.

### Change 5: TOCTOU fix on `/api/skills/complete`

**Problem:** handler does SELECT → check `row.status === 'running'` → UPDATE
without a compare-and-swap. A concurrent cancel between SELECT and UPDATE
gets clobbered.

**Fix:** change the update to atomic:

```ts
const [updated] = await db
  .update(skillRuns)
  .set(updates)
  .where(and(
    eq(skillRuns.id, runId),
    eq(skillRuns.status, 'running'),
  ))
  .returning({ id: skillRuns.id, status: skillRuns.status, finished_at: skillRuns.finished_at });
if (!updated) return error('run no longer in running state', 409);
```

Drop the preceding SELECT's status check (keep the tenant-integrity SELECT
for 404/403). Update the `skills-complete-handler.test.ts` TOCTOU test to
assert 409 when the row isn't `running` at UPDATE time.

### Change 6: socket timeout on LambdaClient

**Problem:** `invokeAgentcoreRunSkill` in `skills.ts` and `job-trigger.ts`
uses `new LambdaClient({})` with no socket timeout. A slow agentcore can
block the 30s-Lambda caller past its API-Gateway 29s cap.

**Fix:** pass `requestHandler: new NodeHttpHandler({ socketTimeout: 28000 })`
to LambdaClient (import from `@smithy/node-http-handler`). 28s lets the 30s
Lambda timeout cleanly with 2s to return an error response.

### PR #1 shipping

- Commit each change as a separate commit (6 total). Clean conventional
  messages.
- Deploy verification: `aws lambda update-function-code` the skills Lambda
  and agentcore image out of band; re-run `scripts/smoke/run-all.sh --ci`
  and `scripts/smoke/complete-smoke.sh`. All should PASS.
- **Out-of-band deploy gotcha:** when pushing a new container image, use an
  explicit tag (e.g. `hardening-<unix-ts>`), NEVER `:latest`, and the
  `docker buildx` command must include `--provenance=false --platform
  linux/amd64`. CI's `:latest` push can otherwise clobber the out-of-band
  deploy. See PR #396's commit message for the pattern.
- Open one PR, wait CI green, squash-merge + delete branch, remove worktree.

## PR #2 — Wire `execution: context` sub-skill dispatch

Makes `sales-prep` actually reach `status=complete` (or fail meaningfully
inside gather) instead of raising at step 1 on `frame`.

### Scope

In `packages/agentcore-strands/agent-container/run_skill_dispatch.py`,
extend `_invoke_sub_skill` to handle `execution: context` in addition to
`execution: script`. For context-mode skills:

1. Load the prompt template from `/tmp/skills/<skill_id>/prompts/<slug>.md`
   (the file name follows the skill slug; check the loaded `skill.yaml` for
   a `prompts[0]` entry or fall back to `<skill_id>.md`).
2. Render the template — minimal `{{ var }}` substitution against the
   sub-skill's `inputs`. Don't invent a full templating engine; the
   `package` skill's `scripts/render.py` already has a
   `_TEMPLATE_TOKEN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")`
   helper — lift that pattern verbatim.
3. Invoke Bedrock Converse with the rendered prompt. Model selection: read
   the skill.yaml's `model` field if present, else fall back to
   `us.anthropic.claude-sonnet-4-6` (the default the existing chat path
   uses — grep `server.py` for the pattern). Keep it simple — one user
   message with the rendered prompt; no system prompt beyond what the skill
   itself provides.
4. Return the response text as the sub-skill's output. composition_runner
   stores it in `named_outputs[step.output]`.

### Container IAM

The agentcore Lambda already has `bedrock-invoke` inline policy permitting
`bedrock:InvokeModel`. No IAM change needed.

### Tests

Add to `test_server_run_skill.py`:

- `test_context_skill_invokes_bedrock_and_returns_text` — mock
  `boto3.client('bedrock-runtime').converse` to return a canned response;
  the dispatch should call it with the rendered template and return the
  text.
- `test_context_skill_missing_prompt_file_raises_clean` — no prompt file on
  disk → SkillNotRegisteredError with a named reason.
- `test_template_token_substitution` — `{{ customer }}` → actual value;
  `{{ missing }}` → empty string or kept literal (match what package's
  render.py does).

### Verification

After deploying the container image:

1. Fire `/api/skills/start` with `skillId=sales-prep`, real inputs. Expect
   either `status=complete` (if all gather branches happen to work —
   unlikely) or `status=failed` with a reason naming a specific missing
   connector (e.g. `step 'gather' failed: skill 'crm_account_summary' not
   registered` — which is a PASS per the composable-skills plan).
2. Important: this changes what the smokes show. Compositions that use
   context-mode sub-skills (sales-prep, renewal-prep) will now progress
   further into `gather` before failing at the first connector. Update
   `scripts/smoke/CHECKS.md` to reflect the new "where compositions fail"
   reality.

### PR #2 shipping

Same flow as PR #1. One fresh worktree off `origin/main` post-merge.

## Working rules (repo conventions, carry verbatim)

- **Worktree discipline.** Always a fresh worktree under
  `.claude/worktrees/<name>` off `origin/main`. Never branch/stash in the
  main checkout. After merge: remove the worktree + delete the branch
  without being asked.
- **PRs target main.** Never stack. Squash-merge.
- **pnpm only.** No `npm`. `npx` is fine for one-off CLI tools.
- **Admin worktree vite ports** (5174, 5175+) must be in Cognito
  `ThinkworkAdmin.CallbackURLs` or Google OAuth fails with a generic-looking
  `redirect_mismatch` error.
- **GraphQL Lambda deploys via PR.** Don't out-of-band
  `aws lambda update-function-code` on `graphql-http`. Other Lambdas
  (skills, job-trigger, agentcore image) are fine to deploy out-of-band for
  verification per the pattern used in #387 and #396.
- **Hand-rolled drizzle migrations** (PR #1 change 3 adds one) need
  `-- creates-column: public.skill_runs.completion_hmac_secret` markers in
  the SQL header so `scripts/db-migrate-manual.sh` sees them. Apply via
  `psql "$DATABASE_URL" -f <file>`, never `db:push`.
- **Read diagnostic logs literally.** If CloudWatch shows `codeLen=37` on a
  UUID, the 37th character is the bug, not noise.

## Start

Begin with PR #1. Create the worktree, check you can run
`scripts/smoke/complete-smoke.sh --tenant-id 0015953e-… --invoker-user-id
4dee701a-…` before making changes (baseline), then implement changes 1–6,
deploy out-of-band, re-run smoke (should still PASS), commit, PR, merge.
Then do PR #2 in a fresh worktree.

## Note on open judgment calls

The 6-change spec for PR #1 is what a review-synthesis pass recommended, but
none of it has been implemented yet, so some edges will need small
judgment calls in-flight:

- **Column name / shape for the HMAC secret**: `completion_hmac_secret`
  (text, nullable, burned on completion) is the default; could also be a
  separate `skill_run_secrets` table if single-use semantics feel safer.
- **Exact retry backoff numbers**: `1s / 3s / 9s ± 0.5s` is a starting
  point; tune if the Aurora p99 says otherwise.
- **Reconciler module placement**: `packages/lambda/` vs
  `packages/api/src/handlers/` — follow the existing pattern for scheduled
  Lambdas in the repo, don't invent a new convention.

Resolve these as you encounter them; don't block on pre-flight design.
