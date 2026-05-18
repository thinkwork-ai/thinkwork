---
date: 2026-05-16
topic: evals-overhaul-redteam-library-and-substrate-fix
---

# Evals Overhaul: Red-Team Library + Substrate Fix

## Summary

Replace the maniflow-era seed pack with a thinkwork-authored red-team library covering default Strands agents, the default Computer, and 2–3 representative skills, and fix the substrate failures that leave full runs hung at 0/96, scheduling not wired end-to-end, and drill-in too thin to debug a failure. Performance/accuracy ships as a smaller representative slice in v1; depth goes into red-team coverage. The dashboard, Studio, CLI, eval-runner Lambda, and AgentCore Evaluate engine stay as-is.

---

## Problem Frame

The evals module was inherited from another project and never re-targeted at thinkwork. Concretely, today: the Evaluations dashboard shows 9 total runs with the most recent 10 days old; three runs are hung at 0/96 (the runner cannot finish a full batch within its current Lambda timeout); completed red-team runs sit at 5–31% pass rate against a corpus authored for a different product; the Schedules tab exists but no scheduled runs have fired.

Meanwhile prospective customers are asking for evals as part of their procurement process — and because thinkwork is distributed as a forkable repo, what each customer needs is a working, drillable evaluations product that ships in the box and runs against the agents they have deployed.

The cost shape: every prospect conversation now hits a credibility gap. The eval page cannot be screenshared without verbal disclaimers ("this part is broken, ignore that run, that pass rate is misleading"), and the existing contents would not survive a security reviewer's first click.

---

## Actors

- A1. Operator: A user with admin access to the customer's deployed thinkwork instance. Triggers eval runs, browses recent runs, drills into failures, configures schedules.
- A2. Scheduler: AWS Scheduler invoking eval runs on a recurring cadence with no human in the loop.
- A3. Prospect / customer security reviewer: Indirect audience. Reads results over the operator's shoulder during procurement, or in the customer's own forked deployment after onboarding.
- A4. CLI user: Engineer or operator running `thinkwork eval ...` from a terminal. Sees the same evals as the dashboard.

---

## Key Flows

- F1. Operator-triggered eval run
  - **Trigger:** Operator clicks "Run Evaluation" in admin UI.
  - **Actors:** A1
  - **Steps:** Operator picks target agent template (or default), one or more categories, and optionally specific test cases. UI starts a run; row appears in Recent Runs with status=running. Runner executes all selected cases against the target agent. Run reaches terminal status; pass rate, cost, and a sortable per-case results table are visible.
  - **Outcome:** A completed run with drillable per-case results.
  - **Covered by:** R1, R2, R6, R8, R10

- F2. Scheduled run
  - **Trigger:** AWS Scheduler fires on the operator-configured cadence.
  - **Actors:** A2 (with A1 reviewing later)
  - **Steps:** Scheduler invokes the runner with the schedule's saved config. Run appears in Recent Runs marked with schedule provenance. Operator opens the dashboard later and sees the run.
  - **Outcome:** Periodic baseline data without operator presence.
  - **Covered by:** R12, R13

- F3. Drill into a failing test case
  - **Trigger:** Operator clicks a failed result in a run's detail page.
  - **Actors:** A1
  - **Steps:** Operator opens the test case result row. Sees the prompt, the agent's full response, the judge model's reasoning, every evaluator's score, the agent's tool-call / span trace, and assertion outcomes. Operator decides whether the failure is a real regression, a flaky LLM judge, or a test-case authoring problem.
  - **Outcome:** Failure understood well enough to act (or de-flag) within ~60 seconds.
  - **Covered by:** R10, R11

---

## Requirements

**Red-team library**

- R1. Ship a thinkwork-authored red-team starter pack covering four dimensions: prompt injection / jailbreak, tool / action misuse, data exfiltration / boundary, and safety + scope + bias.
- R2. The starter pack targets three surface types: default Strands agents, the default Computer, and three representative skills — GitHub, file system, and workspace skills. Slack is intentionally excluded from v1 (see Key Decisions).
- R3. Replace, not augment, the maniflow seed pack. Maniflow-era cases are removed from the seed import; existing customer runs against them are preserved historically but no new runs use them.
- R4. Each test case carries category, target surface, and metadata sufficient to render its purpose in the UI list view without opening the case body.
- R5. Library volume target: ~15 cases per surface × per dimension as the v1 authoring bar. Concretely: 2 agent surfaces × 4 red-team dimensions × ~15 cases ≈ 120 red-team cases for agents + Computer, plus 6–10 representative skill-level cases per skill across the four dimensions. Planning may negotiate small adjustments per cell where authoring naturally clusters, but the order of magnitude is fixed.

Coverage matrix (cells are case-set targets, not exhaustive lists):

| Surface | Prompt injection | Tool misuse | Data boundary | Safety + scope | Performance slice |
|---|---|---|---|---|---|
| Default Strands agents | ~15 | ~15 | ~15 | ~15 | small representative set |
| Default Computer | ~15 | ~15 | ~15 | ~15 | small representative set |
| GitHub skill | example(s) | example(s) | example(s) | example(s) | — |
| File system skill | example(s) | example(s) | example(s) | example(s) | — |
| Workspace skill | example(s) | example(s) | example(s) | example(s) | — |

**Performance slice (v1)**

- R6. Ship a small Performance/accuracy slice per surface — golden-answer matching + LLM-judge over a representative handful of tasks per surface. Not a full Performance category.
- R7. Performance cases are visibly labeled distinctly from red-team in the UI so the categories don't blur in run summaries or the Studio list.

**Runner / substrate fixes**

- R8. Full-corpus runs must reach terminal status. Running the entire enabled corpus against any in-scope agent must finish at `completed`, `failed`, or `cancelled` — not sit at `running` indefinitely. The fix shape is planning's call; the symptom (0/N hangs) is the requirement to remove.
- R9. Per-case results survive runner-level partial failures. A single test case crashing or timing out does not invalidate the rest of the run; the affected case records as `error` with cause, and the run continues.

**Drill-in**

- R10. The per-case result view shows: prompt, agent response, judge model reasoning, per-evaluator scores, assertion outcomes, and the agent's tool-call / span trace.
- R11. Failure modes are visually distinguishable in the per-case view — assertion failure, evaluator low score, judge dissent, runner error, and timeout each render as recognizably different states (not just "fail").

**Scheduling**

- R12. Operators can configure recurring evaluation runs from the admin UI's existing Schedules tab, and configured schedules actually fire end-to-end via the existing `scheduled_jobs` / job-schedule-manager / AWS Scheduler pattern.
- R13. Scheduled runs are marked in the run list with schedule provenance — which schedule fired the run, on what cadence — distinguishable at a glance from operator-triggered runs.

**CLI parity**

- R14. The CLI continues to support `eval run`, `list`, `get`, `watch`, `cancel`, `seed`, and `test-case` subcommands against the new content. No CLI feature regressions during the overhaul.

---

## Acceptance Examples

- AE1. **Covers R8, R9.** Given a run is launched against the entire enabled corpus and one test case crashes the runner mid-execution, when the run continues, then the remaining cases complete, the crashed case is recorded as `error` with cause (not blank), and the run reaches terminal status within its configured timeout.
- AE2. **Covers R10, R11.** Given a red-team test case fails because the LLM judge scored 0.4 against a 0.7 threshold, when the operator opens the case result, then they see the agent's full response, the judge's written reasoning, the score, and a visual indicator that this was a judge-score failure rather than a runner error or assertion miss.
- AE3. **Covers R12, R13.** Given an operator configures a nightly run on the Schedules tab and saves it, when the configured time passes, then a new run appears in the Recent Runs list with provenance indicating it came from that schedule, and status reaches terminal.
- AE4. **Covers R3.** Given a fresh deployment runs the `eval seed` action, when seeding completes, then `eval_test_cases` contains the new thinkwork-authored cases only — no maniflow-era cases are present in the active corpus.

---

## Success Criteria

- A prospect can be shown the live Evaluations dashboard on a sales call without verbal disclaimers; the artifact stands on its own.
- An engineer drilling into a failing test case reaches a confident judgment about whether it is a real regression in under 60 seconds.
- A customer running thinkwork from their own forked deployment inherits a working evals module with red-team content out of the box; no separate authoring step is required to make the dashboard meaningful.
- A scheduled run configured today fires unattended within its cadence and is visible to the operator the next time they open the dashboard.
- `ce-plan` can take this document and produce a unit-by-unit plan without having to invent surface coverage, category dimensions, drill-in contents, or success conditions.

---

## Scope Boundaries

- **Tenant-authored agent template evals.** Operators can still author test cases in Studio against the default agents, but a workflow tailored for evaluating a customer's *own* configured templates (with their tenant-specific AGENTS.md, skills, MCP tools) is deferred.
- **Customer-facing shareable report.** No PDF export, no hosted-link report, no sanitization layer for external publishing. Each customer's own forked dashboard is the artifact.
- **Visual diff / headless browser rendering for Computer artifacts.** Computer outputs are evaluated as text + LLM-judge in v1; richer artifact-level scoring (render success, console errors, shadcn-validator integration, screenshot diff) is deferred.
- **CI / PR-gated eval execution.** Eval runs are operator- and scheduler-triggered only. No git-event triggers, no PR comments, no Actions integration.
- **Full Performance/accuracy category coverage.** v1 ships a representative slice only; broader accuracy benchmarks are a separate scoping pass.
- **Substrate swap to PromptFoo or other file-based eval frameworks.** Rejected — the dashboard-resident + drillable + scheduled requirements fight the file-based-corpus shape.

---

## Key Decisions

- **Keep the existing eval substrate (admin dashboard, Studio, CLI, eval-runner Lambda, GraphQL surface, AgentCore Evaluate).** The failure mode in production is content quality and finishability, not architecture; the existing substrate already meets the customer-triggerable + drillable + scheduled requirements, and PromptFoo would fight those.
- **Replace the maniflow seed pack outright instead of evolving it.** The existing 96-case corpus was authored for a different product; incremental edits would not recover credibility, and full removal makes the new starter pack legible to a prospect drilling in.
- **Trade shareable-report product surface for red-team library depth.** Distribution is forked-repo, so each customer owns their own dashboard; effort that would have built reports goes into more cases.
- **Performance/accuracy ships as a representative slice, not a full category in v1.** Red-team is the prospect-named priority; Performance is task-specific in a way that deserves its own scoping pass once the substrate is solid.
- **AgentCore Evaluate stays the evaluator engine.** Schema, IAM, and the existing runner all assume it; built-in evaluators are pre-provisioned per memory; swapping would multiply the work without changing the customer-visible artifact.
- **Skill picks: GitHub + file system + workspace, no Slack in v1.** File system and workspace skills carry higher data-boundary and tool-misuse stakes per case than notification-style skills; the user prioritized data/IO surface coverage over outbound-message coverage for v1. Slack is the obvious next addition once a prospect drives it.
- **Library volume target: ~15 cases per surface × per dimension.** Sized to show recognizable depth on drill-in without ballooning judge-model cost or authoring time. ~120 red-team cases for agents + Computer is the v1 authoring commitment.

---

## Dependencies / Assumptions

- The 16 AgentCore built-in evaluators referenced in the schema (`Builtin.*` IDs) are actually reachable from dev and prod. Memory records this as ACTIVE; planning should confirm before library authoring commits to specific evaluator IDs. Labeled as unverified — the brainstorm-time scan saw IAM and seed references but did not exercise the live `ListEvaluators` call per stage.
- The existing `scheduled_jobs` / job-schedule-manager / AWS Scheduler / job-trigger Lambda pattern is the right primitive for evaluation schedules. Other recurring work in thinkwork already uses it.
- The Phase-1 system-workflows revert (merged 2026-05-06) is complete; the eval-runner is back to direct invocation and no further substrate decoupling is required before this work starts.
- LLM-as-judge with the current Haiku-class judge model is acceptable quality for both red-team and Performance/accuracy scoring. Rotating judge models is a planning option, not a v1 commitment.
- The hung-at-0/96 symptom is rooted in the runner's batch-vs-timeout shape, not in span collection or evaluator availability. A small reproduction in planning should confirm before committing to a specific fix shape (fan-out, chunked-resume, queue-driven worker — all viable in principle).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R8, R9] [Technical] Confirm the hung-run root cause via a small reproduction — run the full enabled corpus against the current Lambda and measure where it stalls. If the cause is span-collection latency or evaluator-availability rather than batch-vs-timeout, the fix shape changes substantively.
- [Affects R10] [Technical] Best path for the tool-call / span trace in the per-case result view. The eval-runner already fetches AgentCore spans for scoring; planning should determine whether the same data flows into the UI payload or whether a separate fetch is needed.
- [Affects R12, R13] [Technical] Verify what the Schedules tab UI does today — likely it writes to `scheduled_jobs` partially or stubs the action, given no scheduled runs have fired. Planning starts from the actual state, not the inferred state.
- [Affects R6, R7] [Needs research] Performance/accuracy authoring approach for the default Computer. Computer agent outputs are mixed (prose + artifact references); golden-answer matching is shape-dependent. Planning should explore whether LLM-judge alone is the right v1 path for Computer Performance cases or whether a lightweight artifact-presence check is also v1-scope.
