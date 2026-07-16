---
title: Stall Threshold Env Knob + Schedule Enable Flag - Plan
type: fix
date: 2026-07-16
topic: stall-threshold-env-knob-schedule-enable-flag
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
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
