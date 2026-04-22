---
title: "Handoff: start work on AgentCore Code Sandbox plan (fresh session)"
type: handoff
status: open
date: 2026-04-22
parent_plan: docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md
related:
  - docs/brainstorms/2026-04-22-agentcore-code-sandbox-requirements.md
  - docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md
---

# Handoff: start work on AgentCore Code Sandbox plan (fresh session)

## Read this first

You are picking up a Deep-plan implementation of a per-tenant AWS Bedrock AgentCore Code Interpreter as ThinkWork's agent code-execution sandbox. The plan was authored, deepened, and document-reviewed on 2026-04-22 in a prior session. That session applied 20 auto-fixes and surfaced ~15 judgment findings the user has NOT yet decided on — **do not start coding before reading the Open Decisions section below**.

## TL;DR — one command to start

```bash
cd /Users/ericodom/Projects/thinkwork/.claude/worktrees/sandbox-adr
cp ../../../docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md docs/plans/
cp ../../../docs/brainstorms/2026-04-22-agentcore-code-sandbox-requirements.md docs/brainstorms/
cp ../../../docs/plans/2026-04-22-007-handoff-agentcore-code-sandbox-start-work.md docs/plans/
claude
```

Inside the new Claude session:

```
/compound-engineering:ce-work docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md
```

The first agent turn should read this handoff, then the plan, then ask the user to resolve the P0/P1 open decisions before touching code. **Unit 0 (ADR) is the recommended first PR** — pure docs, low risk, and the per-tenant-fanout reasoning is reviewable before Phase 2 commits to it.

## Where things are

- **Plan:** `docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md` (968 lines, deepened, reviewed)
- **Origin brainstorm:** `docs/brainstorms/2026-04-22-agentcore-code-sandbox-requirements.md`
- **Sibling brainstorm (typed-wrapper path):** `docs/brainstorms/2026-04-21-bundled-cli-skills-gogcli-google-workspace-requirements.md`

Both plan + brainstorm currently exist **only in the main-checkout working tree as untracked files**. They are not yet committed. Neither worktree sees them until you either commit them to `main` via a small docs PR OR copy them in (see TL;DR above).

## Worktrees already created

| Worktree | Branch | Intended scope |
|---|---|---|
| `.claude/worktrees/sandbox-adr` | `feat/sandbox-adr` | Unit 0 — ADR only. Ship as standalone docs PR first. |
| `.claude/worktrees/sandbox-phase-1` | `feat/sandbox-phase-1` | Units 1–3 — schema + OAuth branches + template sandbox field |

Both branched from `origin/main` at commit `65da2f6` (ahead of where the main checkout sits because `git fetch` ran mid-session).

If Phase 1 splits further (Units 1 and 2 are independent and could run in parallel review cycles), add `.claude/worktrees/sandbox-phase-1-schema` / `-oauth` as needed. Per user memory `feedback_cleanup_worktrees_when_done`, delete worktrees + branches after their PRs merge without being asked.

## Open Decisions (the user has NOT resolved these)

Resolve each before or during the first coding session. Each is traceable to a finding in the document-review pass.

### P0 — Strategic premise (blocker for starting)

1. **Is this worth building now?** The origin brainstorm explicitly says "we haven't had a customer hit an explicit wall yet"; the whole justification is peer-parity with Managed Agents / Deep Agents / OpenAI Agents / Claude Code. Opportunity cost is the typed-wrapper path (gogcli sibling brainstorm) which covers most of the Problem Frame's cited workloads at lower residual-risk cost.
   - **Ask the user:** name a forcing function (signed enterprise, concrete deal, measurable template-author demand) OR sequence typed-wrapper first OR ship only `internal-only` environment in v1 (drops T1/T2 severity dramatically — no exfil channel, no runtime pip install attack surface, halves Phase 2 complexity).

### P1 — Design tensions to resolve before coding Phase 1

2. **T1b + R13 invariant scope** — plan introduced a new residual threat (T1b: intra-tenant template-author exfil) not in the brainstorm, and re-scoped R13 from "no token in any persisted log" to "no token via Python-stdio or known-shape patterns." Success Criterion #4 in the brainstorm still reads absolutely. Pick one:
   - (a) backfill T1b + revised R13 into the origin brainstorm so goalposts match,
   - (b) pick R-Q4b option (b) per-user ABAC session tags (blocks T1b, adds STS hop),
   - (c) ship per-user interpreters (burns quota: 400+ users × 2 env ≈ 800 of 1000 ceiling).

3. **Unit 5.5 de-provisioning + orphan GC** — there is no `deleteTenant` mutation in the codebase today. Unit 5.5's `deprovisionTenantSandbox` handler has no caller other than the GC. Pick: (a) defer Unit 5.5 until a real tenant-delete mutation lands, OR (b) build now on the grounds that 1000-interpreter quota pressure will surface before tenant-delete does.

4. **SNS platform-security topic (Unit 6)** — no subscriber named; no ack SLA. Pick: (a) keep audit row + app gate; drop SNS until a named subscriber exists, OR (b) build both now with explicit subscriber + SLA in runbook.

5. **Cost-cap sizing arithmetic** — plan's own R-Q8 resolution is internally inconsistent (30 agents × 17/day = 510 > 500 cap). Pick: (a) raise tenant-daily cap to 2000/day upfront (~$960/mo/tenant ceiling), OR (b) explicitly frame v1 caps as "first-week-breach expected; revisit day 7."

### P2 — Architecture questions (can decide during Phase 2/3)

6. **Merge Units 10+11 REST endpoints?** Both fire on every sandbox call. Consider one `/sandbox-invocation` with phase parameter.
7. **Reconciler cadence** — plan says 15 min; reviewer says 1h fill / 4h drift is plenty.
8. **Drop the preflight-import architectural CI test** — framework-ahead-of-need with 4 known call sites. Replace with CONTRIBUTING.md note.
9. **`tenant_policy_events` vs `activity_log`** — before Unit 1, confirm the existing `activity_log.ts` can't accommodate compliance-tier events.
10. **Move `sitecustomize.py` location** — plan puts it in `terraform/modules/app/agentcore-code-interpreter/`; reviewer recommends `packages/agentcore-strands/agent-container-sandbox/` so CI pytest wiring is standard.
11. **AgentCore vs Lambda/Fargate substrate** — plan never compared. Per-tenant fanout (Unit 0 ADR) exists only because of AgentCore's 1000-per-account quota. One paragraph in the ADR naming alternatives considered is the minimum.

### P2 — Documentation & UX gaps

12. **Template-author cognitive surface** — 8 error types, 2 envs, 3 connection types, 3 caps, no self-service admin UI. Add an authoring-time linter affordance + minimal admin UI panel showing sandbox_enabled + counter state.
13. **Deleted/suspended owning user on wakeup** (security F-05) — add check in pre-flight + close-to-use recheck; surface `OwnerAccountUnavailable`.
14. **Preamble invocation-payload integrity** — document the dispatcher→container channel trust model; if mutable in transit, add HMAC.
15. **AgentCore per-session filesystem cross-tenant isolation** — pin the claim to AWS docs or accept T2 at cross-tenant severity.

### P3 — Verify before shipping

16. **`sitecustomize.py` honored by AgentCore runtime?** AgentCore could run under a wrapper with `PYTHONNOUSERSITE=1` that bypasses sitecustomize. Verify empirically in dev before Phase 3a ships — if bypassed, the primary R13 layer is dead on arrival.
17. **Drizzle CHECK drift marker format** — CHECKs aren't `public.X` objects. Verify marker convention or stick to `db:generate`-emitted CHECKs.

## What's already decided (don't re-open)

Per the ce-plan invocation context, these are architecturally decided and not up for debate in this handoff:

- Per-tenant Code Interpreter instances, one per (tenant, environment) pair
- Two environments v1: `default-public` (PUBLIC) + `internal-only` (SANDBOX)
- Per-tenant IAM-scoped Secrets Manager paths; preamble contains path strings only
- Template-opt-in, zero per-assignment ceremony
- Tenant kill switch: `tenants.sandbox_enabled` boolean
- One AgentCore session per agent turn, wiped at turn end, 5-min cap
- Cost caps as real circuit breaker (500/day tenant, 20/hr agent — sizing still TBD per P1 #5)
- T1/T2/T3 accepted as v1 residuals with v2 hardening tracks named
- v1 connection types: google, github, slack
- Typed skills remain primary surface; sandbox is permanent long-tail, no forced graduation

## Auto-fixes applied in the prior session (already in the plan)

Don't re-apply these — they're in the file. 20 total, including: `agents.human_pair_id` (not `owner_user_id`), `costByAgent.query.ts` (not `agentCostBreakdown.query.ts`), flat-file `lambda/agentcore-admin.ts` convention, tag-based GC matching, SM secret cleanup in try/finally, server-side `CURRENT_DATE` boundary discipline, rolling-buffer scrubber for split-writes, split-write + subprocess env exfil added as named residuals, 1000-quota request trigger at 100 tenants (not 250), compound CHECK constraint on tenants, rollout-safe migration (existing tenants flip to `sandbox_enabled=false` during Phase 1 despite the default-true column).

## User memory / standards that apply

- `feedback_worktree_isolation` — always work in `.claude/worktrees/<name>` off `origin/main`
- `feedback_cleanup_worktrees_when_done` — after merge, remove worktree + delete branch without being asked
- `feedback_pr_target_main` — never stack PRs; always rebase onto main
- `feedback_graphql_deploy_via_pr` — `packages/api` edits deploy via merge pipeline; never `aws lambda update-function-code`
- `feedback_avoid_fire_and_forget_lambda_invokes` — tenant-provisioning Lambda invoke is `RequestResponse`
- `feedback_hindsight_async_tools` — don't reshape existing Hindsight wrappers while adding sandbox tools to `server.py`
- `pnpm` not `npm` — always
- Conventional Commits for all commit messages
- CLA sign on first PR (CLA Assistant bot)

## Session handoff quirk (for context)

Mid-session on 2026-04-22, the plan + brainstorm were wiped from the main checkout when a parallel session (in a different worktree or branch) advanced `origin/main` and reset the tree. The files were restored from in-context content. If either file looks shorter than 88KB (plan) / 38KB (brainstorm) on disk, something got reset again — restore from git history or re-derive. This is the practical reason both files remain untracked and need either committing or copying into worktrees before `/ce:work` can find them.
