---
title: Stall Threshold Env Knob + Schedule Enable Flag - Plan
type: fix
date: 2026-07-16
topic: stall-threshold-env-knob-schedule-enable-flag
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Stall Threshold Env Knob + Schedule Enable Flag - Plan

## Goal Capsule

- **Objective:** The stall-monitor threshold and the stall-monitor schedule become per-stage operational knobs — configurable without code changes — while default behavior stays identical to today.
- **Product authority:** THINK-306 (unit U2 / PR-B of `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md`, covering its R3 and enabling R11). Parent authority: THINK-301 (Eric Odom).
- **Open blockers:** None. Scope was fixed by the parent plan's unit carve; all claims below are verified against the current tree.

---

## Product Contract

### Summary

Replace the hardcoded 5-minute stall threshold in the stall-monitor cron with a `STALL_THRESHOLD_MINUTES` environment variable (default 5), and replace the hardcoded `ENABLED` state on the stall-monitor EventBridge Scheduler schedule with a Terraform variable (default enabled). Both knobs are per-stage Terraform inputs.

### Problem Frame

`STALL_THRESHOLD_MINUTES` is a compile-time constant (`packages/api/src/handlers/crons/stall-monitor.ts:18`), so tuning the stall window on a hot tenant requires a code deploy. The schedule resource `aws_scheduler_schedule.stall_monitor` hardcodes `state = "ENABLED"` (`terraform/modules/app/lambda-api/handlers.tf:2462`), so the 2026-07-15 McPherson demo stopgap had to disable the schedule by hand in the AWS console — an out-of-band change the next `terraform apply` silently reverts. The parent fix (THINK-301) needs both as knobs: the threshold for operational tuning during rollout, and the schedule flag so the McPherson re-enable (parent R11) is a declarative, deploy-safe operation instead of console surgery.

### Requirements

**Threshold knob**

- R1. The stall-monitor handler reads its threshold from the `STALL_THRESHOLD_MINUTES` environment variable, defaulting to 5 when the variable is unset.
- R2. An invalid value (non-numeric, zero, or negative) falls back to the default of 5 rather than disabling detection or crashing the cron.
- R3. The environment variable is read inside the handler invocation, not captured at module load, so tests can vary it per case (the vitest env-capture trap).
- R4. The value is injected per-stage via the existing `handler_extra_env` map for the `cron-stall-monitor` handler, sourced from a Terraform variable defaulting to 5.

**Schedule enable flag**

- R5. The `aws_scheduler_schedule.stall_monitor` state is driven by a Terraform variable `stall_monitor_enabled` (default `true`): `ENABLED` when true, `DISABLED` when false.
- R6. With both variables left at defaults, deployed behavior is byte-identical to today: 5-minute threshold, schedule enabled.

**Variable plumbing**

- R7. Both new Terraform variables are declared through the full module chain — `lambda-api` module, its parent modules, and the root declaration in `terraform/examples/greenfield/main.tf` — so `deploy.yml` `-var` passing works on every stage (a missing root declaration fails all deploys).

### Acceptance Examples

- AE1. **Covers R1, R6.** Given no `STALL_THRESHOLD_MINUTES` in the handler environment, when the stall monitor scans, then turns idle less than 5 minutes are untouched and turns idle longer than 5 minutes are flagged — exactly today's behavior.
- AE2. **Covers R1, R3.** Given a test sets `STALL_THRESHOLD_MINUTES=15` before invoking the handler, when a turn has been idle 10 minutes, then it is not flagged; at 16 minutes idle it is flagged.
- AE3. **Covers R2.** Given `STALL_THRESHOLD_MINUTES=abc` or `0`, when the stall monitor runs, then it behaves as if the value were 5.
- AE4. **Covers R5.** Given a stage applies with `stall_monitor_enabled = false`, when Terraform finishes, then the schedule exists in `DISABLED` state — and flipping the variable back to `true` re-enables it on the next apply with no console access.

### Scope Boundaries

- **Out of scope:** The activity-signal fix itself (mid-turn `last_activity_at` bumps) and origin-aware retry — those are sibling units of the parent plan (THINK-307 and peers).
- **Out of scope:** A knob for the retry attempt ceiling (currently 5). The parent plan's Q4 raised it; it stays hardcoded until a need appears.
- **Out of scope:** SSM-based configuration. Env-var-via-Terraform was chosen by the parent unit carve; the per-handler `handler_extra_env` path adds no pressure on the shared `graphql-http` env (which has a 4KB ceiling concern).
- **Out of scope:** Actually re-enabling the McPherson schedule. That is the parent's rollout unit (THINK-310); this unit only makes it a one-variable operation.

### Dependencies / Assumptions

- Parent requirements doc: `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (R3 direct, R11 enabler). This unit blocks THINK-307 and THINK-310.
- The existing `handler_extra_env` per-handler merge (`terraform/modules/app/lambda-api/handlers.tf:258`, applied at `:982`) is the injection point; no new env-plumbing mechanism is needed.
- The stall-monitor schedule resource is guarded by `local.deploy_lambda_handlers`; the enable flag composes with that guard rather than replacing it (customer stages without the control plane keep their current behavior).

### Sources / Research

- Hardcoded threshold: `packages/api/src/handlers/crons/stall-monitor.ts:18`; existing suite `packages/api/src/handlers/crons/stall-monitor.test.ts`.
- Hardcoded schedule state: `terraform/modules/app/lambda-api/handlers.tf:2457-2472`.
- Env injection pattern: `handler_extra_env` at `terraform/modules/app/lambda-api/handlers.tf:258` (analyst-query-broker precedent), merged per handler at `:982`.
- Root-declaration failure mode: `docs/plans/` prior art and deploy history — `deploy.yml` passes `-var` flags that require declarations in `terraform/examples/greenfield/main.tf`; undeclared vars fail every deploy.
- Vitest env-capture trap: env values read at module load are frozen before tests can set them; read inside the handler function.
- Full-chain variable precedent: `brain_dream_state_enabled` — schedule state at `terraform/modules/app/lambda-api/handlers.tf:1956`, module var at `terraform/modules/app/lambda-api/variables.tf:229`, passthrough at `terraform/modules/thinkwork/main.tf:1157` + `terraform/modules/thinkwork/variables.tf:850`, root declaration + wiring at `terraform/examples/greenfield/main.tf:425`/`:861`.

---

## Planning Contract

**Product Contract preservation:** unchanged — R1–R7 and AE1–AE4 carried verbatim from the requirements phase.

### Key Technical Decisions

- **KTD1 — Threshold read per invocation, validated, then treated as a number.** Replace the module-level `const STALL_THRESHOLD_MINUTES = 5` in `packages/api/src/handlers/crons/stall-monitor.ts` with a small resolver (e.g., `resolveStallThresholdMinutes()`) called inside `runStallMonitor`. Parse `process.env.STALL_THRESHOLD_MINUTES`; any value that is not a finite integer > 0 falls back to 5 (R2). Reading inside the invocation satisfies R3 (vitest env-capture trap). The threshold is currently interpolated into three SQL strings via `sql.raw` (the SELECT interval, the `timed_out` error message, and the `retry_queue.last_error` text) — the resolver must return a validated **number** so `sql.raw(String(n))` stays injection-safe, and all three interpolation sites must use the resolved value so the error strings report the real threshold.
- **KTD2 — Mirror the `brain_dream_state_enabled` pattern end to end.** It is the exact precedent for both halves: a boolean module var driving `state = var.x ? "ENABLED" : "DISABLED"` on an `aws_scheduler_schedule`, declared through lambda-api → thinkwork → greenfield root. New vars: `stall_monitor_enabled` (bool, default `true`) and `stall_threshold_minutes` (number, default `5`).
- **KTD3 — Env injection via the existing `handler_extra_env` map.** Add a `"cron-stall-monitor"` entry (`STALL_THRESHOLD_MINUTES = tostring(var.stall_threshold_minutes)`) next to the `analyst-query-broker` precedent at `terraform/modules/app/lambda-api/handlers.tf:258`. No new mechanism; no pressure on the shared `graphql-http` env (4KB ceiling).
- **KTD4 — Enable flag composes with the existing `count` guard.** Only the `state` attribute of `aws_scheduler_schedule.stall_monitor` changes; the `count = local.deploy_lambda_handlers ? 1 : 0` guard is untouched, so customer stages without the control plane keep their current behavior.
- **KTD5 — No `deploy.yml` changes.** Defaults preserve today's behavior on every stage (R6), so no `-var` line is added. Root declarations in `terraform/examples/greenfield/main.tf` (R7) make future per-stage overrides (THINK-310's McPherson flip) a `-var`/tfvars-only operation.

### Assumptions

- Per-stage override values are out of scope here; THINK-310 owns setting `stall_monitor_enabled` explicitly per stage (McPherson re-enable) and any threshold tuning.
- Single-PR delivery (see Implementation Units) matches the parent plan's PR-B carve; the Terraform half without the code half is inert but harmless, and the code half without injection silently keeps the default — grouping removes the dead intermediate states.

---

## Implementation Units

Both units land in **one PR** (parent plan PR-B carve): U1 without U2 is a dead env read that always defaults; U2 without U1 injects an env var nothing consumes. Dependency order within the PR: U1 then U2, but they are separable commits.

### U1. Handler reads validated `STALL_THRESHOLD_MINUTES` per invocation

- **Goal:** The stall-monitor threshold comes from the environment at each invocation, with safe fallback, and every SQL/error string uses the resolved value.
- **Requirements:** R1, R2, R3 (AE1, AE2, AE3)
- **Dependencies:** none
- **Files:** `packages/api/src/handlers/crons/stall-monitor.ts`, `packages/api/src/handlers/crons/stall-monitor.test.ts`
- **Approach:** Per KTD1 — inline resolver called from `runStallMonitor`; delete the module-level const; thread the value through the SELECT interval, the `timed_out` error text, and the `retry_queue.last_error` text.
- **Patterns to follow:** Existing test's `vi.resetModules()` + dynamic `import()` structure; assert on the SQL passed to the mocked `db.execute` to observe the interval/error strings.
- **Test scenarios:**
  - Covers AE1. Env unset → the stalled-turn SELECT uses a 5-minute interval (existing behavior byte-identical).
  - Covers AE2. Test sets `process.env.STALL_THRESHOLD_MINUTES = "15"` before invoking → SELECT interval and both error strings say 15 minutes; a second invocation in the same suite with the env deleted reverts to 5 (proves per-invocation read, not module capture).
  - Covers AE3. `"abc"`, `"0"`, and `"-3"` each → behaves as 5.
  - Fractional/garbage-adjacent values (`"2.5"`, `"5x"`) resolve to a safe value (either the parsed integer rule or the 5 fallback — pick one rule, test it) and never produce `NaN`/`Infinity` in SQL text.
  - Existing mobile-handoff-ordering test still passes unmodified.
- **Verification:** `pnpm --filter @thinkwork/api test` green (full package suite), plus `typecheck`/`lint`.

### U2. Terraform knobs: env injection + schedule enable flag through the full module chain

- **Goal:** `stall_threshold_minutes` and `stall_monitor_enabled` are per-stage Terraform inputs, defaulted so an apply with no overrides is a no-op except the new env var on `cron-stall-monitor`.
- **Requirements:** R4, R5, R6, R7 (AE4)
- **Dependencies:** U1 (same PR; the env var must have a consumer)
- **Files:** `terraform/modules/app/lambda-api/handlers.tf` (`handler_extra_env` entry + schedule `state`), `terraform/modules/app/lambda-api/variables.tf`, `terraform/modules/thinkwork/main.tf`, `terraform/modules/thinkwork/variables.tf`, `terraform/examples/greenfield/main.tf` (root declaration + module wiring)
- **Approach:** Per KTD2–KTD5. `state = var.stall_monitor_enabled ? "ENABLED" : "DISABLED"` on `aws_scheduler_schedule.stall_monitor`; `"cron-stall-monitor"` entry in `local.handler_extra_env`; both vars declared and passed at every layer of the chain — a missing root declaration fails **all** deploys (R7), so the greenfield declarations are non-optional.
- **Test scenarios:** Test expectation: none — pure Terraform configuration; proof is plan-diff inspection (Verification Contract V2/V3).
- **Verification:** `terraform validate` clean; dev `terraform plan` at defaults shows exactly one change (env-var addition on the `cron-stall-monitor` function) and **no** schedule-state diff.

---

## Verification Contract

Quality gates (all must pass before merge): `pnpm --filter @thinkwork/api test` (full package suite), `pnpm -r --if-present typecheck`, `pnpm -r --if-present lint`, `pnpm format:check`, CI green on the PR.

- **V1 — Default stall behavior unchanged, end to end (AE1; proves R1+R6).** Against deployed dev after the merge pipeline finishes: in the dev web app, send a chat message to an agent, then age the running turn (`UPDATE thread_turns SET last_activity_at = NOW() - INTERVAL '10 minutes' WHERE id = <turn>`). Within ~2 minutes the stall monitor flags it. Browser: the thread shows today's timeout surface for that turn (no new/changed UX expected from this unit). Evidence: `thread_turns` row `status = 'timed_out'` with error text naming **5 minutes**, plus a `retry_queue` row for the turn.
- **V2 — Threshold knob is live on the deployed Lambda (R4).** `aws lambda get-function-configuration` on the dev `cron-stall-monitor` function shows `STALL_THRESHOLD_MINUTES=5` in its environment after deploy.
- **V3 — Schedule flag wiring proven without touching dev state (AE4; proves R5+R7).** `terraform plan` on dev with `-var stall_monitor_enabled=false` shows exactly the `state: ENABLED → DISABLED` diff on `aws_scheduler_schedule.stall_monitor` (plan only — do **not** apply); the defaults plan shows no schedule diff. This also proves the root declaration exists (an undeclared root var makes the `-var` flag itself error).
- **V4 — Schedule still enabled in dev (R6).** `aws scheduler get-schedule --name thinkwork-dev-stall-monitor` shows `State: ENABLED` after the post-merge deploy.

---

## Definition of Done

- U1 + U2 merged to `main` in one PR with all quality gates green.
- Post-merge deploy pipeline green (watch it — superseded/cancelled deploys skip the migration gate and can leave dev stale).
- V1–V4 evidence recorded on the Linear issue / progress document.
- No behavior change on any stage at defaults: 5-minute threshold, schedule `ENABLED` (R6).
- THINK-307 and THINK-310 unblocked (both consume this unit's Terraform var patterns).
