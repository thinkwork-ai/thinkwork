---
date: 2026-06-18
linear: THNK-33
status: active
---

# THNK-33 Twenty-Native Launch Proof Status

## 2026-06-18 Workflow Action Wiring Follow-Up

- Latest reopened-gate root cause: the native ThinkWork app package and guarded
  sync path existed, but the target Twenty Customer-stage workflow still had no
  operator-safe repo path to replace the built-in `HTTP_REQUEST` action with
  the installed app action `ThinkWork -> ThinkWork Webhook`.
- Follow-up implementation removes the database-event trigger fallback from the
  ThinkWork app package so the workflow action is the single Twenty-side
  producer for this proof.
- Added `plugins/twenty/scripts/wire-thinkwork-workflow.mjs`, a guarded
  dry-run/apply utility that resolves the installed ThinkWork Webhook logic
  function, targets an explicit workflow/workflow-version/step, and updates a
  draft workflow step to `type: "LOGIC_FUNCTION"`.
- Added Deploy workflow controls for the same operation:
  `wire_twenty_thinkwork_workflow`, dry-run by default, with explicit workflow
  id/version/name/step inputs and optional draft creation from an active
  version.
- No production Twenty mutation was run from Codex. Runtime proof still requires
  an authorized operator to sync the app, configure
  `THINKWORK_WEBHOOK_URL`/`THINKWORK_TRIGGER_STAGE`, dry-run workflow wiring,
  apply to the intended draft, publish/activate in Twenty if required, and move
  a test Opportunity to `Customer`.
- Older entries below are preserved as history. Any evidence based on
  OAuth-only app rows, built-in `HTTP_REQUEST`, or `source=twenty-workflow` is
  not sufficient for the reopened THNK-33 gate.

## 2026-06-18 Native App Sync / Producer Correction

- Latest verification after PR #2627/#2628 found the gate still failing at the
  deployed Twenty instance: the repo package existed, but Twenty had not
  installed/synced the native `ThinkWork` app, no `ThinkWork Webhook` logic
  function was visible, no `THINKWORK_WEBHOOK_URL` app variable existed, the
  legacy workflow still used built-in `HTTP_REQUEST`, and ThinkWork had zero
  `source=twenty-app` deliveries.
- Current branch: `codex/thnk-33-install-sync-automation`.
- Root cause now identified in repo terms: `plugins/twenty/twenty-app` was
  owned and cataloged, but the deploy workflow had no guarded Twenty CLI sync
  step to install/update it in the target Twenty workspace.
- Fix in this pass:
  - `ThinkWork Webhook` now registers a native Twenty database-event trigger:
    `opportunity.updated` with `updatedFields=["stage"]`.
  - The handler still gates by the installed app setting
    `THINKWORK_TRIGGER_STAGE` (default `Customer`) and only calls the installed
    app setting `THINKWORK_WEBHOOK_URL` when the stage matches.
  - The workflow action remains available as an optional
    `ThinkWork -> ThinkWork Webhook` builder action, but built-in
    `HTTP_REQUEST` is not acceptable proof for the reopened gate.
  - Added `plugins/twenty/scripts/sync-thinkwork-app.mjs`, a wrapper around the
    official Twenty CLI `remote:add` + `dev --once` sync flow.
  - Added a manual `deploy.yml` dispatch option
    `sync_twenty_thinkwork_app` gated by `TWENTY_APP_SYNC_API_KEY`; dry-run is
    default, and first install requires dispatching with dry-run disabled.
- Remaining runtime requirement: an operator must run the guarded sync against
  the target Twenty instance and then configure `THINKWORK_WEBHOOK_URL` in the
  installed ThinkWork app Settings tab. This worker did not run production sync
  or mutate the target Twenty instance.

## 2026-06-18 Reopened Gate Follow-Up

- User correction: the fix must be configuration on the Twenty workflow path:
  Twenty Opportunity -> ThinkWork App -> ThinkWork Webhook. The solution must
  not depend on the custom `webhook-crm-opportunity` Lambda.
- Deployed Twenty configuration updated the existing `Closed Won` workflow:
  `opportunity.updated` on `stage`, filter `stage == CUSTOMER`, then an
  `HTTP_REQUEST` action named `Start ThinkWork thread` posts to the ThinkWork
  generic webhook `Twenty Opportunity Closed Won`.
- Twenty workflow publish evidence:
  - workflow id: `e4c9942f-45b9-4922-96b5-fc69a5c1148c`
  - workflow version id: `9e64a00d-4caa-47ea-a18a-9e310da2cd00`
  - automated trigger id: `d0381ec4-6c20-46d4-9b95-1c28ad60f0a0`
- End-to-end verification:
  - Twenty GraphQL updated Opportunity `822639e5-9bf7-40f1-8882-a11140362339`
    (`Platform Migration`) from `PROPOSAL` to `CUSTOMER` at
    `2026-06-18T11:53:26.772Z`.
  - Twenty created workflow run `915b9442-adbf-4e20-ae0f-df9f8bae5fad`,
    `#1 - Closed Won`, status `COMPLETED`, ending at
    `2026-06-18 11:53:29.258+00`.
  - ThinkWork webhook delivery `0e54864d-4037-4897-bf56-c0ea9babe947`
    returned `201`/`ok` at `2026-06-18 11:53:29.188357+00` with payload
    `source=twenty-workflow`, `event=opportunity.won`,
    `opportunityId=822639e5-9bf7-40f1-8882-a11140362339`, and
    `stage=CUSTOMER`.
  - ThinkWork created thread `056ce980-500e-46cf-ba91-76989359a8d8`, title
    `Twenty Opportunity Closed Won`, channel `webhook`, at
    `2026-06-18 11:53:29.107923+00`.
- Follow-up repo fix in this pass: generic webhook target types are normalized
  to lowercase on GraphQL/REST writes and dispatched case-insensitively, and
  delivery records now mark `thread_created=true` when the handler creates a
  thread. This fixes the live `AGENT` vs `agent` mismatch discovered while
  configuring the generic ThinkWork webhook.
- Verification for repo fix:
  - `/Users/ericodom/Projects/thinkwork/node_modules/.pnpm/node_modules/.bin/vitest run packages/api/src/graphql/resolvers/webhooks/createWebhook.mutation.test.ts packages/api/src/graphql/resolvers/webhooks/updateWebhook.mutation.test.ts packages/api/src/graphql/resolvers/webhooks/testWebhook.mutation.test.ts packages/api/src/graphql/resolvers/webhooks/webhooks.query.test.ts`
  - `pnpm --filter @thinkwork/api typecheck` could not run in this fresh
    worktree because `node_modules` is absent (`tsc: command not found`). A
    direct shared-binary fallback also could not resolve workspace package
    dependencies from this worktree.

## 2026-06-18 Native Twenty App Package Follow-Up

- User verification corrected the prior evidence: OAuth-only rows on Twenty's
  Installed apps screen are not sufficient proof of a ThinkWork application
  installed/visible inside Twenty.
- Current implementation branch:
  `codex/thnk-33-twenty-app-package`.
- Added native Twenty app source package at `plugins/twenty/twenty-app`:
  - `defineApplication` app display name: `ThinkWork`
  - secret application variable: `THINKWORK_WEBHOOK_URL`
  - app-stage mapping variable: `THINKWORK_TRIGGER_STAGE`, default `Customer`
  - workflow-action logic function: `ThinkWork Webhook`
  - action source marker sent to ThinkWork: `source=twenty-app`
- The intended workflow path is now:

```text
Twenty Opportunity stage workflow -> ThinkWork app action "ThinkWork Webhook" -> app setting stage == Customer -> configured ThinkWork webhook
```

- The implementation still does not run production sync commands from this
  worker. Installing/syncing the app into deployed Twenty is a production
  mutation and must be done by deployment automation or an operator using
  `plugins/twenty/twenty-app/README.md`.

## 2026-06-18 Customer Stage Settings Follow-Up

- User clarified the deployed Twenty CRM does not have an Opportunity Won stage;
  the relevant Opportunity stage is `Customer`.
- Follow-up branch:
  `codex/thnk-33-customer-stage-webhook-settings`.
- Updated the native Twenty app package so the app settings own the mapping:
  - `THINKWORK_TRIGGER_STAGE`, default `Customer`
  - `THINKWORK_WEBHOOK_URL`, the ThinkWork generic webhook to call
- Updated `ThinkWork Webhook` so non-matching stages return
  `status=skipped_stage` and do not call ThinkWork. Matching stage deliveries
  include `source=twenty-app`, `stage`, and `triggerStage`.

## Current State

- Linear issue: THNK-33 was reopened from `Done` to `Ready to Work` after the
  prior pass over-advanced the issue.
- Implementation base: fresh `origin/main`; active branch:
  `codex/thnk-33-twenty-native-proof`.
- Prior merged proof: PR #2612 delivered `server_contract_verified` only.
- Current proof target: smallest user-visible Twenty Opportunity launch/resume
  path for Customer Onboarding.
- Explicitly not claimed: rich Twenty embedded app packaging,
  Twenty logic-function installation, and native Twenty status writeback
  execution.

## Rebound Evidence

- PR #2612 only added signed server-side task-event ingress, Twenty linked-task
  provider support, idempotent append/wake behavior, diagnostics, fixtures, and
  the server-contract runbook.
- Linear comments on 2026-06-17 explicitly recorded that #2612 did not
  implement native Twenty embedded app installation, plugin manifest packaging,
  logic-function producer installation, or `native_producer_verified`.
- The 2026-06-18 dispatcher prompt corrected the issue back to implementation
  work because user-visible Twenty-native launch/status proof was missing.

## Scope Decision

Implement a constrained fallback that proves the approved user workflow without
claiming the blocked native producer path:

- Add durable `crm_work_links` for one active
  Twenty Opportunity + Customer Onboarding outcome.
- Add `startTwentyCustomerOnboarding`, a first-slice GraphQL mutation that
  resumes an existing link before requiring fresh CRM auth, and requires the
  installed `twenty` plugin plus current-user activation before creating new
  work.
- Add an authenticated web launch route:
  `/crm/twenty/opportunity/:objectId/customer_onboarding`.
- Record status/writeback state on the link as `blocked` with
  `NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED` until deployed self-hosted Twenty app
  runtime/writeback can be proven.
- Document verification and blocker evidence separately from the already-landed
  server task-event proof.

## Progress

| Unit                                   | Status              | Evidence                                                                    |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| Discovery and rebound classification   | Complete            | Linear state history and comments confirm Done -> Ready rebound after #2612 |
| CRM work-link schema                   | Implemented locally | `crm_work_links` schema, migration, GraphQL contract, schema test           |
| Twenty Opportunity onboarding mutation | Implemented locally | Resume-first/create-with-activation mutation plus focused resolver tests    |
| Web launch route                       | Implemented locally | Authenticated CRM launch page and component tests                           |
| Native Twenty app/writeback blocker    | Documented locally  | Status link failure code and verification doc                               |
| PR                                     | Pending             | Not opened yet                                                              |
| CI/merge                               | Pending             | Not run remotely yet                                                        |

## Native Twenty Blocker

Current `origin/main` now contains `plugins/twenty`, but this pass still cannot
honestly claim native Twenty embedded app or logic-function installation proof:

- `plugins/twenty/src/manifest.ts` still includes `mcp-server` and
  `infrastructure` components only because the ThinkWork plugin catalog schema
  does not yet support a `twenty-app` component type.
- The native Twenty app package now lives beside the manifest under
  `plugins/twenty/twenty-app` and is tracked as plugin-owned runtime source,
  but it must be synced through Twenty's app tooling before the deployed
  Applications screen proves installation.
- The manifest's comments keep UI/native app surfaces out of scope for the
  current package contract.
- The approved native operating-surface plan says rich embedded panels and
  native app extension packaging require deployed self-hosted capability
  verification before they can be treated as product proof.
- The current implementation therefore records CRM status handle state in
  ThinkWork and exposes the launch/resume route, but leaves actual Twenty-side
  writeback as blocked pending deployed runtime evidence.

## Verification Log

Local verification on 2026-06-18:

- `pnpm schema:build`
- `pnpm --filter @thinkwork/web codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/database-pg test -- __tests__/crm-work-links-schema.test.ts`
- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/crm/startCustomerOnboardingFromCrmRecord.mutation.test.ts`
- `pnpm --filter @thinkwork/web test -- src/components/crm/CrmCustomerOnboardingLaunch.test.tsx`
- `pnpm --filter @thinkwork/database-pg typecheck`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/web typecheck`
- `pnpm --filter thinkwork-cli typecheck`
- `pnpm lint`
- `pnpm --filter @thinkwork/web build`
- `git diff --check`
- Targeted Prettier check via
  `pnpm dlx prettier@3.8.2 --check --ignore-unknown <touched files>`

Notes:

- `pnpm --filter @thinkwork/api codegen` reports no matching package script on
  current `main`.
- `pnpm --filter @thinkwork/mobile typecheck` reports no matching package
  script on current `main`.
- Root `pnpm format:check` cannot run in this fresh worktree because `prettier`
  is not installed as a root dependency; the targeted `pnpm dlx prettier`
  check passed for touched files.

## Next Autopilot Steps

- Run format/codegen and focused verification.
- Commit and open the implementation PR.
- Wait for CI, fix real failures, and merge when allowed.
- Move THNK-33 to `Verification/Review` with Eric assigned because the issue
  has the `Human` label.
