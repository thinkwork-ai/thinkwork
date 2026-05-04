---
title: Flue Deep Researcher — first-agent launch runbook & cold-start measurement log
date: 2026-05-04
category: docs/solutions/architecture-patterns/
module: agentcore-flue
problem_type: agent_launch
component: agent_runtime
severity: medium
applies_when:
  - Deploying the first ThinkWork agent on the Flue runtime substrate
  - Capturing cold-start latency for `session.task()` sub-agent fan-out
  - Validating Flue's MCP egress + Aurora SessionStore + Code Interpreter integration end-to-end
  - Comparing Flue and Strands runtime behavior on equivalent workloads
related:
  - docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md
  - docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md
tags:
  - flue
  - deep-researcher
  - first-agent
  - cold-start
  - launch-runbook
  - r14
  - fr-f2
---

# Flue Deep Researcher — first-agent launch runbook & cold-start measurement log

This runbook executes plan §005 U14: deploy the first ThinkWork agent (Deep Researcher) on the Flue runtime, exercise every Phase 2 unit (Aurora SessionStore U4, run_skill U5, Memory + Hindsight U6, MCP wiring U7, Code Interpreter sandbox U8, handler shell U9, bearer-scrub egress U16), and capture concrete cold-start latency for `session.task()` sub-agent fan-out.

The runbook is **operator-driven**: the deploy, invoke, and measure actions are not automated. CI cannot validate them because they require live AWS resources, real LLM tokens, and human-validated agent output. The "Measurement Log" section below is intentionally empty at the time of merge; the operator running U14 fills it in post-launch.

---

## Prerequisites

Before running U14, confirm:

- [ ] Plan §005 U1–U13 + U16 merged on `main` (`git log origin/main --oneline | head -20`).
- [ ] CI green on `main` for the agentcore-flue container build.
- [ ] You have AWS CLI access to the `dev` stage (Bedrock, Lambda, AgentCore, Aurora, S3).
- [ ] You have `thinkwork` CLI installed and authenticated against the `dev` Cognito pool (`thinkwork me -s dev`).
- [ ] You have an MCP search server endpoint + bearer token reachable from the agent (the runbook uses an existing wired connector — do not introduce new connector work for U14).
- [ ] You have a deterministic Python skill registered in `packages/skill-catalog/` whose output is suitable for safe exercise (e.g., a result-formatting skill). If none exists, the operator MUST define one before invocation; the absence of a Python skill blocks the `run_skill` exercise leg of U14's Phase 2 coverage.

---

## Step 1 — Build & deploy the agentcore-flue container

The agentcore-flue runtime is provisioned by the terraform module shipped in U2; the container image is built by the existing CI pipeline.

```bash
# From repo root, on a clean main checkout:
pnpm install
pnpm -r --if-present build
pnpm -r --if-present typecheck
pnpm -r --if-present test

# Build & push the container image. The CI pipeline does this on push to main;
# manual rebuild is only needed if you've made local changes you want to deploy.
bash scripts/build-agentcore-flue.sh   # if a build script exists; otherwise via CI

# Apply the agentcore-flue terraform module to the dev stage.
thinkwork deploy -s dev
```

**Verification — runtime is ACTIVE:**

```bash
aws bedrock-agentcore list-agent-runtimes --region us-east-1 \
  --query 'agentRuntimes[?contains(agentRuntimeName, `agentcore-flue`)]'
```

Expect `runtimeStatus: "ACTIVE"` for the `dev` stage's agentcore-flue runtime.

**Operator note — warm-container env-injection timing:** if you see "missing THINKWORK_API_URL / API_AUTH_SECRET" errors in CloudWatch immediately post-deploy, this matches the warm-container env-injection race documented in `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`. The mitigation is the entry-snapshot pattern (capture env vars at coroutine entry, not after the agent turn) plus the 15-minute reconciler that flips stalled `skill_runs` rows. Force a warm-flush only if the symptom persists past the reconciler window.

---

## Step 2 — Create the Deep Researcher agent_template

`agent_templates` is a Postgres table seeded via the admin GraphQL mutation (no migration-based seeder exists — system templates are tenant-scoped and created via the admin UI or `gh api graphql`).

**Required fields:**

| Field | Value |
|---|---|
| `name` | `Deep Researcher` |
| `slug` | `deep-researcher` |
| `description` | `Multi-step web research with sub-agent fan-out, Python formatting, and AgentCore Memory.` |
| `source` | `system` |
| `runtime` | `flue` *(critical — selects the Flue runtime per U3)* |
| `model` | A Bedrock model id, e.g. `anthropic.claude-sonnet-4-6-20251001-v2:0` |
| `skills` | `[{ skill_id: "<web-search-skill-uuid>", enabled: true }, { skill_id: "<format-skill-uuid>", enabled: true }]` |
| `sandbox` | `{ environment: "default-public" }` *(opts the template into the Code Interpreter sandbox per U8)* |

The skill_ids must reference real rows in `skills`. Look them up first:

```bash
psql "$DATABASE_URL" -c "SELECT id, slug, name FROM skills WHERE slug IN ('web-search', '<your-format-skill-slug>');"
```

Then create the template via the admin GraphQL mutation. Substitute the bearer for the dev admin Cognito session and the resolved skill ids:

```graphql
mutation CreateDeepResearcherTemplate {
  createAgentTemplate(input: {
    name: "Deep Researcher"
    slug: "deep-researcher"
    description: "Multi-step web research with sub-agent fan-out, Python formatting, and AgentCore Memory."
    source: "system"
    runtime: "flue"
    model: "anthropic.claude-sonnet-4-6-20251001-v2:0"
    skills: [
      { skill_id: "<WEB_SEARCH_SKILL_UUID>", enabled: true }
      { skill_id: "<FORMAT_SKILL_UUID>", enabled: true }
    ]
    sandbox: { environment: "default-public" }
  }) {
    id
    slug
    runtime
  }
}
```

**Verification:**

```bash
psql "$DATABASE_URL" -c "SELECT id, slug, runtime, source FROM agent_templates WHERE slug = 'deep-researcher';"
```

Expect a single row with `runtime = 'flue'` and `source = 'system'`.

---

## Step 3 — Create a test agent from the template

In the admin UI:

1. Navigate to Agents → Create Agent → select template `Deep Researcher`.
2. Assign the agent to a test tenant (avoid customer-facing tenants for U14's first traffic).
3. Configure the test user's MCP bearer for the search server (mobile self-serve flow per `feedback_user_opt_in_over_admin_config`).

Verify:

```bash
psql "$DATABASE_URL" -c "
  SELECT a.id, a.slug, a.template_id, t.runtime
  FROM agents a JOIN agent_templates t ON a.template_id = t.id
  WHERE t.slug = 'deep-researcher';
"
```

Expect at least one row with `runtime = 'flue'`.

---

## Step 4 — Smoke test: minimal invocation

Before exercising the full deep-researcher capability, confirm the runtime accepts an invocation and responds:

```bash
# Locate the agent's UUID and a valid Cognito session token for the test user.
AGENT_ID="<deep-researcher-agent-uuid>"
SESSION_TOKEN="$(thinkwork session -s dev --json | jq -r '.idToken')"

# Send a minimal "hello" prompt via chat-agent-invoke Lambda.
curl -X POST "https://<api-gateway>.execute-api.us-east-1.amazonaws.com/graphql" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "query": "mutation { invokeAgent(agent_id: \"$AGENT_ID\", message: \"hello\") { thread_id, response } }"
}
EOF
)"
```

**Verification — bearer-scrub contract:** after the invocation, grep CloudWatch logs for any leak of the active bearer. Run BOTH filters — `Bearer ey` catches JWT-style tokens (most common); the literal-active-bearer grep catches non-JWT formats (Okta / Cognito opaque tokens) that the JWT prefix would miss:

```bash
LOG_GROUP="/aws/bedrock-agentcore/agentcore-flue-dev"
START_TIME="$(date -v-10M +%s)000"

# Filter 1 — JWT-shaped bearer prefix.
aws logs filter-log-events --region us-east-1 \
  --log-group-name "$LOG_GROUP" --filter-pattern "Bearer ey" \
  --start-time "$START_TIME" --query 'events[*].message' --output text

# Filter 2 — literal active bearer (substitute the actual token used in
# the invocation). CloudWatch Logs filter syntax does not support
# regex; literal substring match is the universal path.
ACTIVE_BEARER="<bearer-used-in-test-invocation>"
aws logs filter-log-events --region us-east-1 \
  --log-group-name "$LOG_GROUP" --filter-pattern "$ACTIVE_BEARER" \
  --start-time "$START_TIME" --query 'events[*].message' --output text
```

Expect zero matches from BOTH filters. Any match indicates the U16 scrubbing-fetch interceptor missed a path; **block the launch** and triage before proceeding.

---

## Step 5 — Full Phase 2 exercise

Issue a research prompt that requires every Phase 2 unit to participate:

> "Research the latest developments in AWS Bedrock AgentCore Memory, summarize the top three takeaways, and format the result as a numbered markdown list."

The expected execution chain:

1. **Aurora SessionStore (U4)** — handler reads/writes thread state by `(tenantId, agentId, threadId)`.
2. **MCP wiring (U7) + bearer-scrub (U16)** — agent calls the search MCP tool; handle→bearer swap fires at the egress fetch.
3. **Sub-agent fan-out (`session.task`)** — agent dispatches a sub-agent to summarize each search result. Sub-agents create fresh AgentCore Code Interpreter sessions per U8.
4. **AgentCore Code Interpreter sandbox (U8)** — sub-agent or top-level executes the Python format skill via `executeCommand`.
5. **AgentCore Memory + Hindsight (U6)** — agent persists context for subsequent turns.
6. **run_skill (U5)** — Python format skill executes.
7. **Bedrock model routing** — every LLM call routes through Flue's `init({ model, providers })`.

**Verification:**

- [ ] Top-level response contains 3 numbered takeaways.
- [ ] Sub-agent traces visible in admin (per AGENTS.md routing).
- [ ] CloudWatch logs show `executeCommand` invocations for the Python format skill.
- [ ] Aurora `thread_messages` row count incremented (per-turn write).
- [ ] AgentCore Memory id resolved and used (logs show `memory_engine: "managed"` or `"hindsight"` depending on stack config).
- [ ] Zero bearer-shape matches in CloudWatch logs (per Step 4 verification).
- [ ] Agent response is comparable in quality to a Strands-routed reference. *(Operator judgment.)*

---

## Step 6 — Cold-start latency capture

`session.task()` cold-start (the `StartCodeInterpreterSession` round-trip) is the dominant first-call latency for sub-agent fan-out. The plan needs concrete p50/p95/p99 to make the per-task vs shared-session decision.

**Methodology:**

1. Issue 20+ deep-researcher invocations to the test agent, with prompts that each trigger at least one `session.task()` sub-agent dispatch.
2. Capture per-invocation telemetry via CloudWatch Logs Insights:

   ```sql
   fields @timestamp, message
   | parse message /session_task_started: (?<task_id>\S+)/
   | parse message /StartCodeInterpreterSession_complete: task_id=(?<complete_task_id>\S+) elapsed_ms=(?<elapsed_ms>\d+)/
   | filter ispresent(elapsed_ms)
   | stats count(), avg(elapsed_ms), pct(elapsed_ms, 50), pct(elapsed_ms, 95), pct(elapsed_ms, 99) by bin(1m)
   ```

3. Record p50, p95, p99 in the **Measurement Log** below.

**Operator note — instrumentation prerequisite:** `Date.now()` deltas around `StartCodeInterpreterSession` calls in `agentcore-flue` are NOT yet wired. The structured logger exists but no code path emits `session_task_started` / `StartCodeInterpreterSession_complete` events with `elapsed_ms`. Before step 6 the operator must:

1. Identify the call sites (likely in `packages/agentcore-flue/agent-container/src/server.ts` near the runLoop and in the SandboxFactory paths from U8) where `StartCodeInterpreterSession` is invoked — there may be more than one per turn (`session.task()` sub-agent fan-out).
2. Wrap each call site with `const t0 = Date.now(); ...; logStructured({event: "...", elapsed_ms: Date.now() - t0})`.
3. Pick a stable event-name vocabulary the CloudWatch Logs Insights query above can parse — recommended: `session_task_started`, `StartCodeInterpreterSession_complete`.
4. Land that instrumentation as a separate small PR (it's not a one-line change but should be a single short commit) before running the cold-start sample. The launch is the right time to wire it because live latency is the data we need to capture.

If you'd rather measure cold-start without code changes, AgentCore X-Ray traces capture the SDK call duration — but X-Ray needs to be enabled on the runtime first; check `aws bedrock-agentcore get-agent-runtime` for the trace-enabled flag.

---

## Measurement Log

*This section is empty at the time of merge. The operator running U14 fills it in post-launch.*

### Cold-start latency — `session.task()` sub-agent fan-out

| Metric | Value | Sample size | Stage | Captured at |
|---|---|---|---|---|
| p50 | TBD ms | TBD | dev | TBD |
| p95 | TBD ms | TBD | dev | TBD |
| p99 | TBD ms | TBD | dev | TBD |

### Token usage (Flue vs Strands reference)

| Workload | Flue avg input + output tokens | Strands reference avg | Delta | Notes |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

### Eval scores (AgentCore Evaluations)

| Evaluator | Flue score | Strands reference score | Delta |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

### Operator notes

*(Free-form: deviations from runbook, surprises, edge cases discovered, follow-up issues filed.)*

---

## Rollback playbook

Per Plan §005 Risks: "First-agent-on-parallel-runtime couples two bets (deep researcher × Flue validation)". The mitigation is per-agent runtime selector flip — emergency rollback is a one-line column update in `agent_templates`:

```sql
UPDATE agent_templates
SET runtime = 'strands'
WHERE slug = 'deep-researcher' AND source = 'system';
```

After the rollback:

1. Subsequent invocations for the deep-researcher agent route to the Strands runtime.
2. Existing in-flight invocations on Flue complete naturally (they read the agent's runtime at dispatch time, not turn time).
3. Investigate the Flue-side issue without time pressure; re-flip the column to `'flue'` after the fix is merged + redeployed.

This rollback path requires NO code change, NO redeploy, NO downtime. The `chat-agent-invoke` runtime selector dispatcher (per U3) handles the column flip dynamically.

---

## Strategic Commitments tripwires

Plan §005's Phase 4 follow-up calls for a 2-week production observation deliverable that lands as `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-{date}.md`. **Minimum threshold for the verdict to fire: ≥500 turns OR extend the observation window beyond 2 weeks if traffic is sparse.**

The DX comparison covers:

- Prompt visibility (Flue's hot-reload + dispatch ergonomics vs Strands' compiled prompt path)
- Debugging fidelity (worker_thread crash traces vs Strands' callback chain)
- Observability (OTel/X-Ray parity for AgentCore Eval scoring)
- Trusted-handler-injection ergonomics (HandleStore vs Strands' opaque token plumbing)

The deep researcher's traffic is one of the inputs to that comparison; this runbook's Measurement Log is consulted directly.

---

## Sources & References

- **Plan:** [docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md](../../plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md) (U14 spec at line 797)
- **Origin brainstorm:** [docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md](../../brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md)
- **FR-9a spike verdict:** [docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md](./flue-fr9a-integration-spike-verdict-2026-05-03.md)
- **Bearer-scrub egress wiring:** Plan §005 U16 (`packages/agentcore-flue/agent-container/src/scrubbing-fetch.ts`)
- **Runtime selector dispatcher:** `packages/api/src/lib/resolve-runtime-function-name.ts`
- **Warm-container env-injection timing:** `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`

---

## Plan §005 status after this launch

When the Measurement Log section above is fully populated and the launch verifies green:

- Plan §005 is **complete**. U1–U14 + U16 all shipped (U15 was never assigned — gap is intentional per U-ID stability).
- The frontmatter at `docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md` flips `status: active → completed`.
- The 2-week observation window for the DX comparison artifact begins.
