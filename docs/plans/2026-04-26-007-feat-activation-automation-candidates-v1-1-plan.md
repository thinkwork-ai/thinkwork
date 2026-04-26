---
title: "feat: Activation Automation Suggestions V1.1"
type: feat
status: active
date: 2026-04-26
origin: docs/brainstorms/2026-04-26-agent-activation-operating-model-requirements.md
---

# feat: Activation Automation Suggestions V1.1

## Overview

Extend the merged Activation Agent V1 so a completed operating-model interview can produce **personal automation suggestions only**. V1.1 shows the user candidate recurring-work ideas on mobile, grounded in confirmed activation outputs, without creating scheduled jobs, EventBridge schedules, routines, tenant-wide automations, or specialist folders.

This is deliberately a preview/suggestion surface. Approval, provisioning, pause/resume/delete, and recurring execution move to a later version after the product value and safety model are proven.

## Requirements Trace

- R1. Generate automation suggestions only from confirmed Activation layer outputs for the activation session owner/current authenticated user.
- R2. Suggestions are personal: every candidate is scoped to `tenant_id`, `user_id`, and the user's paired/personal agent target.
- R3. V1.1 never creates or provisions recurring jobs. There is no approve/apply action for automation suggestions in this version.
- R4. Mobile shows the suggested rhythm, timezone, target agent, prompt preview, why it was suggested, and conservative cost/run estimate metadata.
- R5. Duplicate generation attempts do not create duplicate active suggestion cards for the same user/session/normalized candidate key.
- R6. Same-tenant other users, tenant admins, and API-key callers cannot list or generate another user's automation suggestions through the self-service path.
- R7. Sparse, ambiguous, or cadence-free activation outputs return an empty suggestion list rather than fabricating intent.
- R8. Mobile iOS verification proves the deployed suggestion path: activation review can request suggestions and render the empty and non-empty states using the Expo `.env`.

## Scope Boundaries

- No scheduled-job creation or `scheduled_jobs.user_id` migration in V1.1.
- No EventBridge Scheduler provisioning, job-trigger execution, pause/resume/delete, or retry state in V1.1.
- No admin-led, bulk, tenant-wide, team, routine, or specialist-folder recommendations.
- No blanket approval or default apply for automation candidates.
- No inline schedule/prompt editing in V1.1.

## Deferred Follow-Up

- V1.2 or later: explicit approval that creates user-owned scheduled jobs through the existing Scheduler path.
- V1.2 or later: pause, resume, delete, retry, and duplicate-linking to existing active schedules.
- V1.2 or later: richer cost estimation and schedule editing.
- Separate plan: specialist folder/agent recommendations.

## Relevant Code And Patterns

- `docs/plans/2026-04-26-001-feat-agent-activation-operating-model-plan.md` — V1 plan that defers automation candidates to follow-up.
- `packages/database-pg/src/schema/activation.ts` — activation sessions, turns, and outbox; add suggestion candidates here rather than hiding state inside `layer_states`.
- `packages/api/src/graphql/resolvers/activation/shared.ts` — existing activation access helpers and GraphQL mapping patterns.
- `packages/database-pg/graphql/types/activation.graphql` — add typed suggestion candidates and query/generation mutation.
- `apps/mobile/app/activation/review/index.tsx` — render suggestions alongside staged Activation updates.
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md` — enforce personal-only targets in code, not prompt prose.
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — bind ownership from the resolved user/session owner, never ambient tenant context.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — hand-rolled migrations need markers and drift verification.
- `AGENTS.md` mobile instructions — copy `apps/mobile/.env` from the main checkout and build `@thinkwork/react-native-sdk` before Expo verification.

## Key Decisions

- **Keep V1.1 suggestions-only.** The schema can preserve nullable future-facing fields, but no resolver or mobile affordance creates a schedule.
- **Use typed candidate rows.** `activation_automation_candidates` stores the generated review state, duplicate key, disclosure metadata, target agent, schedule expression, and prompt preview.
- **Self-only authorization.** Candidate list/generate uses a dedicated owner guard. It does not reuse `assertActivationAccess` because that helper has a tenant-admin fallback.
- **Personal agent target only.** The generator selects the user's paired agent (`agents.human_pair_id = session.user_id`) in the same tenant. No routine/team/tenant target is generated.
- **Deterministic generation first.** V1.1 starts from `rhythms` and `decisions` layer entries with explicit `scheduleExpression` or clear daily/weekly cadence. Sparse data yields no candidates.
- **Conservative schedule support.** Explicit schedules must be `cron(...)` or `rate(...)`; inferred daily/weekly rhythms use cron expressions and UTC until richer timezone capture exists.
- **Stable duplicate suppression.** Candidate insertion uses a user-scoped duplicate key and a partial unique index over active suggestion states.

## Candidate Lifecycle

| Candidate status | Mobile label | Meaning |
|---|---|---|
| `generated` | Suggested | Reviewable personal automation idea. No schedule exists. |
| `deferred` | Saved for later | User wants to revisit the suggestion later. |
| `dismissed` | Dismissed | User rejected the suggestion; retained for suppression/metrics. |

## Implementation Units

- U1. **Candidate schema and migration**

  Add `activation_automation_candidates` with manual migration markers, user/session/tenant fields, target metadata, prompt/config/cost JSON, status, duplicate key, and timestamps.

- U2. **Activation GraphQL suggestions API**

  Add `activationAutomationCandidates(sessionId)` and `generateActivationAutomationCandidates(sessionId)`. Both load the session, enforce self-only access, and return stable typed candidate data. Generation is idempotent and creates at most three candidates.

- U3. **Mobile review surface**

  Update the Activation review screen to request personal automation suggestions and render candidate cards with schedule, target, prompt preview, why-suggested text, and estimate metadata. Empty state is calm and does not block applying the core Activation bundle.

- U4. **Verification**

  Cover the migration markers, GraphQL schema contract, pure candidate generation heuristics, API typecheck, generated consumer types, and Expo mobile build with the copied `.env`.

## Test Scenarios

- Happy path: a weekly rhythm entry creates one `generated` suggestion with a cron schedule, target agent id, cost estimate metadata, and duplicate key.
- Happy path: rerunning generation for the same session returns existing candidates instead of inserting duplicates.
- Edge case: null, malformed, unsupported, sparse, or cadence-free layer entries do not crash and do not fabricate schedules.
- Error path: API-key caller and same-tenant other user cannot list/generate suggestions for another user's activation session.
- Error path: unsupported schedule expression text such as "tomorrow morning" is ignored.
- Mobile path: review screen renders suggestions and no-suggestions states without offering an approve/apply automation action.

## Verification Commands

- `pnpm --filter @thinkwork/database-pg test -- migration-0041.test.ts`
- `pnpm --filter @thinkwork/api test -- activation-automation-candidate-builder.test.ts graphql-contract.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/database-pg build`
- `pnpm schema:build`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/react-native-sdk build`
- `cp /Users/ericodom/Projects/thinkwork/apps/mobile/.env apps/mobile/.env`
- `pnpm --filter @thinkwork/mobile build:web`

## Operational Notes

- This PR intentionally does not require manual scheduled-job migration or EventBridge validation.
- The new migration is still hand-rolled, so `pnpm db:migrate-manual` should be used after applying it in dev/prod.
- Post-merge deployed iOS simulator proof should cover only suggestion generation/rendering for V1.1. Schedule creation belongs to the later approval/provisioning plan.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-26-agent-activation-operating-model-requirements.md](../brainstorms/2026-04-26-agent-activation-operating-model-requirements.md)
- **Parent plan:** [docs/plans/2026-04-26-001-feat-agent-activation-operating-model-plan.md](2026-04-26-001-feat-agent-activation-operating-model-plan.md)
- Related code: `packages/database-pg/src/schema/activation.ts`
- Related code: `packages/api/src/graphql/resolvers/activation/shared.ts`
- Related code: `apps/mobile/app/activation/review/index.tsx`
