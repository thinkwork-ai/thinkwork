---
date: 2026-06-18
linear: THNK-33
status: active
---

# THNK-33 Twenty-Native Launch Proof Status

## 2026-06-18 Twenty App Package Version Retry Fix

- PR #2654 merged the Twenty local logic-function runtime fix:
  `https://github.com/thinkwork-ai/thinkwork/pull/2654`, merge commit
  `857f9c2338581fca7ccd90a0a6943a5c344e2de2`.
- Main deploy run `27785104575` succeeded after applying that fix. AWS ECS
  verification showed both live Twenty task definitions include
  `LOGIC_FUNCTION_TYPE=LOCAL`:
  - `thinkwork-dev-twenty-server:17`
  - `thinkwork-dev-twenty-worker:17`
- Apply-mode `sync-app` run `27787290464` on main commit
  `d4314919668b38d4067a4e4079c98b92124935b9` validated the package and target
  secrets, then failed during publish because Twenty already has
  `@thinkwork/twenty-app` version `0.1.0` from the earlier publish attempt:
  `Cannot deploy ...@0.1.0: version must be higher than the currently deployed version 0.1.0.`
- Root cause: run `27784032724` successfully published the private native app
  package at `0.1.0` before failing on install. Twenty requires monotonic app
  package versions for subsequent publishes.
- Follow-up fix: bump `plugins/twenty/twenty-app/package.json` to `0.1.1` so
  the next apply-mode `sync-app` can publish a new package and retry the native
  workspace install against the now-enabled local logic-function runtime.
- Runtime proof still requires merging this package-version retry fix,
  rerunning apply-mode `sync-app`, confirming the native `ThinkWork` app appears
  in Twenty, configuring `THINKWORK_TRIGGER_STAGE=Customer` and
  `THINKWORK_WEBHOOK_URL`, wiring the Customer workflow to `ThinkWork Webhook`,
  and verifying a `source=twenty-app` delivery.

## 2026-06-18 Twenty Workflow Wiring Metadata Endpoint Fix

- PR #2657 merged the native app version bump:
  `https://github.com/thinkwork-ai/thinkwork/pull/2657`, merge commit
  `82396ee5a57f30a13d4c4732438ffe6075ef1931`.
- Apply-mode `sync-app` run `27787896006` on merge commit
  `82396ee5a57f30a13d4c4732438ffe6075ef1931` succeeded:
  - Packed `@thinkwork/twenty-app@0.1.1`.
  - Uploaded `thinkwork-twenty-app-0.1.1.tgz`.
  - Published with `Published @thinkwork/twenty-app v0.1.1 to thinkwork-crm`.
  - Installed with `Application installed`.
- Non-mutating `wire-workflow` dry-run `27787967595` then failed before
  workflow lookup because the wiring script queried installed logic functions
  through Twenty's data GraphQL endpoint (`/graphql`):
  `Cannot query field "findManyLogicFunctions" on type "Query".`
- Root cause: installed app metadata such as logic functions is exposed through
  Twenty's metadata GraphQL endpoint (`/metadata`), while workflow records are
  exposed through the workspace data endpoint (`/graphql`).
- Follow-up fix: split the wiring script into a metadata client for
  `findManyLogicFunctions` and a data client for workflow lookup/update.
- Runtime proof still requires merging this endpoint fix, rerunning
  non-mutating workflow wiring dry-run, applying workflow wiring to a draft,
  configuring `THINKWORK_TRIGGER_STAGE=Customer` and `THINKWORK_WEBHOOK_URL`,
  and verifying a `source=twenty-app` delivery.

## 2026-06-18 Twenty Workflow Relation Shape Fix

- PR #2659 merged the metadata endpoint fix:
  `https://github.com/thinkwork-ai/thinkwork/pull/2659`, merge commit
  `cc88c5a1daf9bc20f3378dc33fd455c31610e87e`.
- Non-mutating `wire-workflow` dry-run `27789128185` on that merge commit
  confirmed the script now reaches the workflow lookup path against the target
  Twenty instance, then failed while selecting a workflow version:
  `TypeError: workflow.versions is not iterable`.
- Root cause: the deployed Twenty GraphQL API returns workflow relation fields
  in connection-style shapes for at least this query path, not always as plain
  arrays. The script should normalize relation payloads before selecting a
  workflow version.
- Follow-up fix: normalize array, `edges[].node`, and `nodes` relation shapes
  before enumerating workflows and workflow versions.
- Runtime proof still requires merging this relation-shape fix, rerunning
  non-mutating workflow wiring dry-run, applying workflow wiring to a draft,
  configuring `THINKWORK_TRIGGER_STAGE=Customer` and `THINKWORK_WEBHOOK_URL`,
  and verifying a `source=twenty-app` delivery.

## 2026-06-18 Twenty Logic Function Runtime Config Fix

- PR #2652 merged the Twenty 2.9 compatibility fix:
  `https://github.com/thinkwork-ai/thinkwork/pull/2652`, merge commit
  `5fa8caadf27d889a693595cf51d9f07ef447377d`.
- Apply-mode `sync-app` run `27784032724` on merge commit
  `5fa8caadf27d889a693595cf51d9f07ef447377d` advanced past the prior version
  gate:
  - Built and packed `@thinkwork/twenty-app@0.1.0`.
  - Uploaded `thinkwork-twenty-app-0.1.0.tgz`.
  - Published successfully with
    `Published @thinkwork/twenty-app v0.1.0 to thinkwork-crm`.
- The install step then failed while creating the native app logic function:
  `Migration action 'create' for 'logicFunction' failed` with
  `LOGIC_FUNCTION_DISABLED`.
- Root cause: the deployed Twenty server keeps production logic functions
  disabled unless `LOGIC_FUNCTION_TYPE` is set to `LOCAL` or `LAMBDA`. Because
  THNK-33 must use the native ThinkWork app workflow action and must not use a
  custom Lambda path, the managed Twenty runtime needs to enable Twenty's local
  logic-function driver for this first-party trusted app.
- Follow-up fix:
  - Set `LOGIC_FUNCTION_TYPE=LOCAL` in the shared Twenty ECS base environment,
    which applies to both server and worker containers.
  - Document the setting in the Twenty Terraform module README.
  - Add plugin test coverage proving the managed Twenty module enables the
    local logic-function driver required by `ThinkWork Webhook`.
- Runtime proof still requires merging this config fix, applying the managed
  Twenty deployment so ECS picks up the environment variable, rerunning
  apply-mode `sync-app`, confirming the native `ThinkWork` app appears in
  Twenty, configuring `THINKWORK_TRIGGER_STAGE=Customer` and
  `THINKWORK_WEBHOOK_URL`, wiring the Customer workflow to `ThinkWork Webhook`,
  and verifying a `source=twenty-app` delivery.

## 2026-06-18 Twenty 2.9 Package Compatibility Fix

- After explicit operator authorization, apply-mode `sync-app` run
  `27783189027` attempted the native app install against
  `https://crm.thinkwork.ai`.
- Evidence from the failed apply:
  - `Deploy and install native ThinkWork app` ran in `mode: "apply"`.
  - The workflow built the manifest, typechecked the app, packed
    `@thinkwork/twenty-app@0.1.0`, and uploaded
    `thinkwork-twenty-app-0.1.0.tgz`.
  - Twenty rejected the upload with
    `Upload failed: App requires Twenty server >=2.13.0 <3.0.0 but this server is 2.9.0.`
- Root cause: the live Twenty CRM is server `2.9.0`, while the native app
  package declared a `>=2.13.0 <3.0.0` Twenty engine range. That rejection
  happens before workspace install, so the Twenty Applications screen still
  only shows seeded apps and OAuth registrations.
- Follow-up fix:
  - Set the native app package engine to `>=2.9.0 <3.0.0`.
  - Pin `twenty-sdk` and `twenty-client-sdk` to `2.9.0`.
  - Regenerate the nested app `yarn.lock`.
  - Update the manifest regression test to guard the deployed CRM compatibility
    floor.
- Local validation:
  - `npx -y @yarnpkg/cli-dist@4.13.0 install` inside
    `plugins/twenty/twenty-app`.
  - `npx -y @yarnpkg/cli-dist@4.13.0 twenty dev:build` succeeded with
    `Running typecheck` and `Build succeeded (4 files)`.
- Runtime proof still requires merging this compatibility fix, rerunning
  apply-mode `sync-app`, confirming the native `ThinkWork` app appears in
  Twenty, configuring `THINKWORK_TRIGGER_STAGE=Customer` and
  `THINKWORK_WEBHOOK_URL`, wiring the Customer workflow to `ThinkWork Webhook`,
  and verifying a `source=twenty-app` delivery.

## 2026-06-18 Twenty App Non-Mutating Preflight Pass

- PR #2649 merged the dry-run compatibility fix:
  `https://github.com/thinkwork-ai/thinkwork/pull/2649`, merge commit
  `1290484aa314ccb7cb9ee5588ff5420f13a5c05f`.
- Non-mutating `sync-app` preflight run `27780108426` on merge commit
  `1290484aa314ccb7cb9ee5588ff5420f13a5c05f` passed.
- Evidence:
  - `Validate native ThinkWork app package` passed.
  - `Check Twenty app operation secrets` passed with
    `TWENTY_PUBLIC_URL=https://crm.thinkwork.ai` and a masked
    `TWENTY_APP_SYNC_API_KEY`.
  - `Deploy and install native ThinkWork app` ran in `mode: "dry-run"` and
    validated the package and Twenty remote credentials without deploying or
    installing.
  - The Twenty CLI reported `Using remote: thinkwork-crm`,
    `Server: https://crm.thinkwork.ai`, and `Auth: api-key (valid)`.
  - `Wire Customer workflow to ThinkWork app action` was skipped because this
    run only validated native app sync preflight.
- No production Twenty mutation was run from Codex. The remaining THNK-33 gate
  still requires an explicit apply-mode install/sync of the native app into
  Twenty, app Settings configuration for `THINKWORK_TRIGGER_STAGE=Customer` and
  `THINKWORK_WEBHOOK_URL`, workflow wiring to `ThinkWork Webhook`, and a
  verified `source=twenty-app` delivery.

## 2026-06-18 Twenty App Dry-Run Compatibility Fix

- PR #2648 merged the empty-config/default-remote fix:
  `https://github.com/thinkwork-ai/thinkwork/pull/2648`, merge commit
  `d0de3991558c9df8e9c7c00aabda3460676d6361`.
- Non-mutating `sync-app` dry-run after #2648, run `27779421334` on
  `d0de3991558c9df8e9c7c00aabda3460676d6361`, proved the wrapper now reaches
  the Twenty CLI and target server:
  - `Validate native ThinkWork app package` passed.
  - `Check Twenty app operation secrets` passed.
  - `Deploy and install native ThinkWork app` reached
    `Using remote: thinkwork-crm`, `Checking server`, `Building manifest`,
    `Building application files`, and `Computing metadata diff`.
- The run failed at the deployed Twenty schema boundary:
  `Dry run failed with error: Unknown argument "dryRun" on field "Mutation.syncApplication".`
- Root cause: the installed/deployed Twenty server at `crm.thinkwork.ai` does
  not currently expose the `syncApplication(dryRun:)` argument expected by
  `twenty-sdk@2.13.0`'s `yarn twenty dev --once --dry-run` path. This is a
  dry-run compatibility problem, not an app package build problem and not a
  missing deploy secret.
- Fix in this pass:
  - Keep apply mode unchanged: private publish followed by app install.
  - Change sync preflight/dry-run to validate the package in the workflow's
    existing `yarn twenty dev:build` step and validate the configured Twenty
    remote/auth with `yarn twenty --remote thinkwork-crm remote:status`.
  - Update the runbook and workflow input wording so the non-mutating gate is
    not described as a metadata-diff preview against the unsupported server
    mutation.
- No production Twenty mutation was run from Codex in this pass.

## 2026-06-18 Twenty App Sync Dry-Run Config Fix

- After `TWENTY_DEPLOY_API_KEY` was added as a GitHub Actions secret,
  non-mutating `sync-app` dry-run `27777614844` advanced past the secret gate
  on merge commit `d56c31a5d2af7419d4911ee6f0fb4fa9eb057537`.
- The run still failed before `yarn twenty dev --once --dry-run` could start:
  `Deploy and install native ThinkWork app` printed the dry-run summary,
  completed `yarn install`, then exited with `Unexpected end of JSON input`.
- Root cause: `plugins/twenty/scripts/sync-thinkwork-app.mjs` parsed
  `~/.twenty/config.json` directly. Twenty's own config service treats an
  empty config file as `{}`, but the wrapper called `JSON.parse("")`; any empty
  Actions config file crashed the wrapper before the Twenty CLI could use the
  provided remote credentials.
- Fix in this pass:
  - Treat missing or empty Twenty config as `{}` before writing the target
    remote.
  - Persist `defaultRemote: "thinkwork-crm"` alongside the remote entry so a
    fresh runner matches the CLI state created by `yarn twenty remote:add`.
  - Run dry-run with the explicit global remote:
    `yarn twenty --remote thinkwork-crm dev --once --dry-run`.
  - Add a focused node-native test for empty config handling and preserving
    existing remotes.
- Verification:
  - `pnpm --filter @thinkwork/plugin-twenty test -- scripts/__tests__/sync-thinkwork-app.test.mjs`
  - `node --check plugins/twenty/scripts/sync-thinkwork-app.mjs`
  - `git diff --check`
- No production Twenty mutation was run from Codex in this pass.

## 2026-06-18 Isolated Twenty App Operations Follow-Up

- Latest runtime-operations gap: the guarded sync/wire inputs existed in
  `.github/workflows/deploy.yml`, but any manual dispatch of that workflow also
  enters the regular deploy path before Twenty app operations. That made even
  dry-run app evidence unnecessarily coupled to Terraform/deploy jobs.
- Added `.github/workflows/twenty-thinkwork-app.yml`, a dedicated manual
  operations workflow for the native ThinkWork app package.
- The new workflow always validates the Twenty app package with
  `yarn twenty dev:build`, then can run `sync-app`, `wire-workflow`, or
  `sync-and-wire`.
- Dry-run remains the default for both native app sync and workflow wiring.
  Any apply mode requires the exact confirmation string
  `APPLY TWENTY THINKWORK APP`.
- The workflow does not run Terraform, deploy ThinkWork, or use the custom
  Lambda path. It only uses `TWENTY_PUBLIC_URL` plus `TWENTY_DEPLOY_API_KEY`
  (preferred) or `TWENTY_APP_SYNC_API_KEY` (fallback) for the native
  `Twenty -> ThinkWork App -> ThinkWork Webhook` operations.
- No production Twenty mutation was run from Codex. Runtime proof still
  requires an authorized operator to dispatch this workflow in apply mode,
  configure the ThinkWork app settings, and verify a `source=twenty-app`
  delivery.
- Non-mutating workflow validation on `main` exposed a package isolation issue:
  Yarn 4 treated `plugins/twenty/twenty-app` as part of the root project unless
  the nested app carried its own `yarn.lock`. Follow-up adds that nested
  project marker so `yarn install` in the app directory works in GitHub Actions
  and in the sync script.
- The next non-mutating validation reached Yarn resolution and exposed that the
  workflow validation step also needed the sync script's non-immutable install
  behavior. Follow-up makes the workflow run non-immutable `yarn install`
  before `yarn twenty dev:build`.
- Non-mutating workflow validation now passes on `main` after PR #2634:
  run `27769070287` on merge commit
  `aaef174f24a8e1d373b8d6860af50a9b2846b135` completed successfully. Evidence:
  `Validate native ThinkWork app package` ran
  `YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install` and
  `yarn twenty dev:build`; the apply-only confirmation, secret-check, app-sync,
  and Customer-workflow wiring steps were skipped.
- Non-mutating `sync-app` dry-run on `main` now fails before sync because the
  target Twenty operation credential is not configured in GitHub Actions:
  run `27770029462` on merge commit
  `a3e949ce0e6ecb9db7a192a86ee294b74834523b` passed
  `Validate native ThinkWork app package`, showed
  `TWENTY_PUBLIC_URL=https://crm.thinkwork.ai`, then failed
  `Check Twenty app operation secrets` with empty `TWENTY_APP_SYNC_API_KEY`.
  No app sync, app install, workflow wiring, or production Twenty mutation ran.
  The next required operator input is to set repository secret
  `TWENTY_DEPLOY_API_KEY` (preferred Twenty naming) or
  `TWENTY_APP_SYNC_API_KEY` to a Twenty API key that can deploy and install
  native apps.
- Follow-up review against Twenty's current app docs found that our package
  shape was valid, but the apply path still used Twenty's development sync loop
  (`yarn twenty dev --once`) instead of the documented private application
  lifecycle for an internally deployed app. The corrected apply path now
  deploys the tarball with `yarn twenty app:publish --private --remote ...`
  and installs it into the workspace with
  `yarn twenty app:install --remote ...`; dry-run remains non-mutating through
  `yarn twenty dev --once --dry-run`.
- Non-mutating `sync-app` dry-run after the lifecycle correction still fails
  before deploy/install because no deploy API key exists in GitHub Actions:
  run `27772519761` on merge commit
  `6b8163ae80bcd4d0069e9d3a6f6b88089a04a655` passed
  `Validate native ThinkWork app package`, showed
  `TWENTY_PUBLIC_URL=https://crm.thinkwork.ai`, then failed
  `Check Twenty app operation secrets` with empty `TWENTY_APP_SYNC_API_KEY`
  and message `Set repository secret TWENTY_DEPLOY_API_KEY or
TWENTY_APP_SYNC_API_KEY before running Twenty app operations.` The
  `Deploy and install native ThinkWork app` and workflow wiring steps were
  skipped, so no production Twenty mutation ran. GitHub repo secrets and
  environments do not currently expose either deploy key, and AWS
  Secrets Manager / SSM metadata did not show an existing Twenty deploy API key
  secret to reuse.
- Added `docs/runbooks/twenty-thinkwork-native-app-install.md` as the concrete
  operator checklist for the remaining install: set `TWENTY_DEPLOY_API_KEY`,
  run `sync-app` dry-run/apply, configure the ThinkWork app Settings tab, wire
  the Customer workflow to `ThinkWork -> ThinkWork Webhook`, and verify a
  `source=twenty-app` delivery.
- Follow-up app-package verification on fresh `origin/main` confirmed
  `yarn twenty dev:build` emits a manifest with app `ThinkWork`, custom
  Settings tab front component `thinkwork-settings`, app variables
  `THINKWORK_WEBHOOK_URL` and `THINKWORK_TRIGGER_STAGE=Customer`, and workflow
  action `ThinkWork Webhook`. The app package now commits the real Yarn 4
  lockfile instead of an empty project-marker lockfile, so private publish and
  install runs use reproducible dependency resolution.
- Non-mutating operations evidence after the real lockfile merge:
  - `validate-package` run `27775897315` on merge commit
    `01f6688415d2e79ec129b1f28fa3678e76549fb5` passed. It ran the native
    app package validation and skipped secret checks, app sync/install, and
    workflow wiring.
  - `sync-app` dry-run `27775930121` on the same merge commit passed
    `Validate native ThinkWork app package`, showed
    `TWENTY_PUBLIC_URL=https://crm.thinkwork.ai`, then failed
    `Check Twenty app operation secrets` because `TWENTY_APP_SYNC_API_KEY` was
    empty. The log message was `Set repository secret TWENTY_DEPLOY_API_KEY or TWENTY_APP_SYNC_API_KEY before running Twenty app operations.` The deploy/install and workflow-wiring steps were skipped, so no production Twenty mutation ran.

## 2026-06-18 Native App Settings Surface Follow-Up

- Latest objective tightening: the native Twenty app package must include a
  real `ThinkWork App` settings surface for webhook configuration, not only
  server-side application variable declarations or OAuth registration rows.
- Added `thinkwork-settings`, a `defineFrontComponent` settings tab registered
  through `settingsCustomTabFrontComponentUniversalIdentifier` on the
  `ThinkWork` app package.
- The settings tab saves `THINKWORK_WEBHOOK_URL` and
  `THINKWORK_TRIGGER_STAGE` through Twenty's metadata
  `updateOneApplicationVariable` mutation. `THINKWORK_TRIGGER_STAGE` still
  defaults to `Customer`.
- The `ThinkWork Webhook` workflow action continues to read those native app
  variables, so the intended path is:
  `Twenty Opportunity stage == Customer -> ThinkWork app Settings -> ThinkWork Webhook`.
- Local non-production evidence: Twenty CLI `dev:build` succeeded and generated
  a manifest containing app `ThinkWork`, settings custom tab front component
  `c132535c-b8f3-43a4-8dc2-3deefb3dc825`, app variables
  `THINKWORK_WEBHOOK_URL`/`THINKWORK_TRIGGER_STAGE`, and workflow action
  `ThinkWork Webhook`.
- No production Twenty mutation was run from Codex. Runtime proof still
  requires an authorized operator to sync/install this app package, open the
  ThinkWork app Settings tab, save the ThinkWork webhook URL, wire the Customer
  workflow step to `ThinkWork -> ThinkWork Webhook`, and verify a
  `source=twenty-app` delivery.

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
