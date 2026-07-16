---
title: McPherson Stall Monitor Re-enable + Rollout Verification - Plan
type: fix
date: 2026-07-16
topic: mcpherson-stall-monitor-reenable-rollout
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# McPherson Stall Monitor Re-enable + Rollout Verification - Plan

## Goal Capsule

- **Objective:** The McPherson stall monitor — disabled out-of-band in the AWS console on 2026-07-15 as a demo stopgap — is re-enabled as declared Terraform state on a build that carries the corrected stall pipeline, and the rollout is verified with recorded evidence on every affected stage.
- **Product authority:** THINK-310 (unit U7 / PR-F of THINK-301); parent Product Contract in `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (covers parent R11, Verification Contract V5).
- **Open blockers:** Gated on sibling units THINK-305 (U1), THINK-306 (U2), THINK-307 (U3), THINK-308 (U4+U5) being merged **and deployed to McPherson's pinned runner**; THINK-309 (U6) precedes it under the parent's deploy ordering (PR-F strictly last). This gate is the unit's subject matter, not an impediment to planning it.

---

## Product Contract

### Summary

Flip the McPherson stall-monitor schedule from its out-of-band console `DISABLED` back to Terraform-declared `ENABLED` — but only via a deploy that already carries the corrected pipeline (U1–U4), so re-enabling cannot resurrect the false-positive `timed_out` verdicts the disable was papering over. The unit is operational: its deliverables are the gated flip, before/after scheduler evidence, a zero-false-positive monitoring window, and a genuine-stall drill proving detection still works.

### Problem Frame

The repo Terraform hardcodes the stall-monitor schedule `state = "ENABLED"` (`terraform/modules/app/lambda-api/handlers.tf:2463`), so the 2026-07-15 console disable on McPherson is silent drift: **any** Terraform apply on that stack re-enables the monitor with whatever code the applied release carries. Before U1 lands in McPherson's release, that means re-enabling the broken monitor (every >5-minute chat turn falsely `timed_out` — parent D4). Meanwhile the disable itself has a cost: genuine stalls on McPherson currently go undetected, with no automatic or prompted recovery. This unit closes both exposures in the right order.

McPherson deploys through the pinned customer deploy runner (control-plane stacks do not auto-update the S3 runner; TEI and McPherson sit at runner v364), so "deployed to McPherson" is an explicit runner/release update operation, not a side effect of merging to main.

### Key Decisions

- **No per-customer `stall_monitor_enabled` runner wiring in this unit.** U2's var defaults to `true`, and customer-settable vars require three wiring points in the control-plane runner (`vars_json` allowlist + generated root module variable + `module "thinkwork"` argument in `write_runner_files`, `terraform/modules/app/deployment-control-plane/runner.py` — see `docs/solutions/integration-issues/controller-vars-allowlist-blocks-cognito-ses-invite-emails.md`). The re-enable needs none of that: an apply on a release carrying U2 reasserts `ENABLED` from the default. The console disable remains the break-glass path for emergencies; wiring a per-customer knob through the runner is a named follow-up only if a real need appears. (LFG decision — adopted recommended option.)
- **The runner update is the flip vehicle.** Re-enabling is not a config edit on McPherson: it is updating the pinned S3 runner/release to a version carrying U1–U4 (per the customer-runner ledger process) and applying. The same apply that re-enables also ships the fix, which is what makes the flip safe.
- **Freeze applies until the gate holds.** Between now and the U7 flip, no Terraform apply may run on the McPherson stack from a release lacking U1 — such an apply would silently re-enable the broken monitor (D4). This standstill is an explicit operational requirement, not an assumption.

### Requirements

**Gated flip**

- R1. No Terraform apply runs on the McPherson stack before the U7 flip unless its release carries at least U1 (the activity bump); the pre-flip console `DISABLED` state is otherwise preserved.
- R2. McPherson's pinned customer runner/release is updated to a version verified to carry U1–U4 (and, per the parent deploy ordering, U6) before or as part of the enabling apply; the verified release/runner version is recorded.
- R3. After the flip, the McPherson stall-monitor schedule is `ENABLED` as Terraform-declared state — `aws scheduler get-schedule` matches what the applied configuration declares, with no out-of-band drift remaining.

**All affected stages**

- R4. dev and prod stall monitors remain `ENABLED` via var-driven state (explicit `true` or the default) after U2 ships — the U2 refactor plus this rollout must not silently disable any stage.

**Verification evidence (parent V5)**

- R5. Before/after `aws scheduler get-schedule` output for McPherson is recorded in the issue/Progress document.
- R6. McPherson runs ≥1 business day post-flip with zero false-positive `timed_out` verdicts, measured as: no `timed_out` turn whose activity/finalize evidence shows it was actively progressing when flagged (parent query: `timed_out` turns whose `finished_at` predates a later successful finalize).
- R7. A genuine-stall drill on dev (parent V3 rerun) is green on the shipped build: stall detected, silent recovery, exactly one final answer — proving the re-enabled monitor still catches real stalls.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given McPherson's runner is still at a pre-U1 version, when any deploy/apply is proposed for that stack, then it is blocked (not run) until the runner/release is updated to a U1-carrying version — and the first apply from that version is the flip itself.
- AE2. **Covers R3, R5.** Given the flip apply completes, when `aws scheduler get-schedule --name thinkwork-mcpherson-stall-monitor` is compared before/after, then the state transitions `DISABLED → ENABLED` and the after-state is what Terraform declares (re-applying is a no-op on the schedule).
- AE3. **Covers R6.** Given one business day of post-flip McPherson traffic including chat turns longer than the stall threshold, when `timed_out` verdicts are queried, then none corresponds to a turn that was actively progressing when flagged.
- AE4. **Covers R7.** Given a synthetic genuine stall on dev on the shipped build, when the monitor flags it, then automatic recovery completes silently and the thread shows exactly one final answer.

### Scope Boundaries

- **Out of scope (sibling units):** the activity bump (U1/THINK-305), the `stall_monitor_enabled` var and threshold knob themselves (U2/THINK-306), retry dispatcher wiring (U3/THINK-307), finalize reconciliation + manual Retry guard (U4+U5/THINK-308), the recovery UI surface (U6/THINK-309).
- **Out of scope:** wiring `stall_monitor_enabled` through the customer runner's `vars_json` allowlist / generated root module (per Key Decisions — follow-up only on demonstrated need).
- **Out of scope:** application code changes. Expected repo delta is zero-to-small (ops evidence + possibly docs); the unit may legitimately ship as pure operations recorded in Linear.
- **Out of scope:** re-enabling or changing any other schedule (retry dispatcher enablement is U3's, governed by the parent's deploy-ordering constraint).

### Dependencies / Assumptions

- U2's `stall_monitor_enabled` Terraform var lands with default `true` and composes with the existing `local.deploy_lambda_handlers` guard (THINK-306 contract).
- Operator access to McPherson's AWS account (scheduler describe) and to the customer-runner update process (S3 runner overwrite per the customer-deploy ledger) is available at ship time.
- McPherson's live stack may drift from repo Terraform (customer stacks deploy through the pinned runner); U3's verification includes inspecting McPherson's live scheduler state for both crons, and this unit consumes that finding rather than re-deriving it.
- The stall-monitor schedule name on McPherson follows the `thinkwork-<stage>-stall-monitor` pattern (`handlers.tf:2460`); confirm the actual stage slug during execution.

### Outstanding Questions

**Deferred to planning**

- Q1. Whether the monitoring window (R6) is verified by a one-off SQL query against McPherson's DB, a repeated manual check, or a small evidence script — and where the query text is recorded so the check is reproducible.
- Q2. Exact runner-update mechanics for McPherson (which ledger steps, who runs them) — consume `docs/solutions` customer-runner material and the THINK-307 live-scheduler findings at planning time.

### Sources / Research

- Parent contract + plan: `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (R11, D4, U7, V5, deploy ordering).
- Hardcoded schedule state: `terraform/modules/app/lambda-api/handlers.tf:2457-2463` (verified this session).
- Customer-runner var allowlist: `terraform/modules/app/deployment-control-plane/runner.py` (`write_runner_files`, `vars_json` — verified this session); three-wiring-points rule in `docs/solutions/integration-issues/controller-vars-allowlist-blocks-cognito-ses-invite-emails.md`.
- Sibling unit contracts: `docs/plans/2026-07-16-002-fix-stall-clock-midturn-activity-bump-plan.md` (U1), `docs/plans/2026-07-16-002-fix-stall-threshold-env-knob-schedule-enable-flag-plan.md` (U2).
