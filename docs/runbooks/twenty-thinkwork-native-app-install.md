---
date: 2026-06-18
linear: THNK-33
status: active
---

# Twenty ThinkWork Native App Install Runbook

This runbook installs the native Twenty `ThinkWork` app package into the
ThinkWork Twenty workspace, then wires the Customer-stage workflow to the app's
`ThinkWork Webhook` action.

Do not use the OAuth app rows as proof for THNK-33. The verification target is a
native installed Twenty app with a Settings tab and workflow action.

## Current Target

- Twenty URL: `https://crm.thinkwork.ai`
- App source: `plugins/twenty/twenty-app`
- GitHub workflow: `Twenty ThinkWork App Operations`
- Preferred GitHub secret: `TWENTY_DEPLOY_API_KEY`
- Fallback GitHub secret: `TWENTY_APP_SYNC_API_KEY`
- Trigger stage: `Customer`
- ThinkWork event: `opportunity.stage.customer`
- ThinkWork workflow key: `customer_onboarding`

## Prerequisites

1. Create or obtain a Twenty API key with deploy permission on
   `https://crm.thinkwork.ai`.
2. Store it in GitHub Actions as repository secret `TWENTY_DEPLOY_API_KEY`.
3. Confirm repository variable `TWENTY_PUBLIC_URL` is
   `https://crm.thinkwork.ai`.

Twenty's app publishing docs call for `TWENTY_DEPLOY_API_KEY` in GitHub
repository secrets and describe it as an API key with deploy permission on the
target server. The key is required before either private app publish or
workspace install can run.

## Preflight

Run the isolated workflow in non-mutating mode first:

```bash
gh workflow run "Twenty ThinkWork App Operations" \
  --repo thinkwork-ai/thinkwork \
  --ref main \
  -f operation=sync-app \
  -f sync_dry_run=true
```

Expected result:

- `Validate native ThinkWork app package` passes.
- `Check Twenty app operation secrets` passes.
- `Deploy and install native ThinkWork app` runs in dry-run mode and validates
  the configured Twenty remote/auth with `yarn twenty remote:status`.
- No production Twenty mutation happens.

If the run fails with `Set repository secret TWENTY_DEPLOY_API_KEY or
TWENTY_APP_SYNC_API_KEY`, the app cannot be installed yet.

The deployed `crm.thinkwork.ai` schema does not currently accept the Twenty
CLI's `syncApplication(dryRun:)` argument, so preflight intentionally avoids the
unsupported metadata-diff mutation. The non-mutating gate is package build plus
remote/auth validation; the install step below is the first app publish/install
mutation.

## Install

Only run apply mode after preflight succeeds:

```bash
gh workflow run "Twenty ThinkWork App Operations" \
  --repo thinkwork-ai/thinkwork \
  --ref main \
  -f operation=sync-app \
  -f sync_dry_run=false \
  -f apply_confirmation="APPLY TWENTY THINKWORK APP"
```

Expected result:

- The workflow publishes the private app tarball with
  `yarn twenty app:publish --private --remote thinkwork-crm`.
- The workflow installs it with
  `yarn twenty app:install --remote thinkwork-crm`.
- Twenty Applications shows a native installed app named `ThinkWork`.
- The app detail page exposes the `Settings` tab.

## Configure App Settings

Open Twenty:

```text
Settings -> Applications -> Installed -> ThinkWork -> Settings
```

Set:

- `THINKWORK_TRIGGER_STAGE`: `Customer`
- `THINKWORK_WEBHOOK_URL`: the ThinkWork generic webhook URL for Customer
  onboarding

The webhook URL is secret. Do not paste it into Linear, GitHub comments, or repo
files.

## Wire Workflow

Run a dry-run first. Prefer exact workflow and step ids from Twenty:

```bash
gh workflow run "Twenty ThinkWork App Operations" \
  --repo thinkwork-ai/thinkwork \
  --ref main \
  -f operation=wire-workflow \
  -f wire_dry_run=true \
  -f twenty_workflow_id="<workflow-id>" \
  -f twenty_workflow_step_id="<http-request-step-id>" \
  -f trigger_stage=Customer \
  -f thinkwork_event=opportunity.stage.customer \
  -f workflow_key=customer_onboarding
```

When the dry-run report identifies the intended Customer workflow and step,
apply to a draft workflow version:

```bash
gh workflow run "Twenty ThinkWork App Operations" \
  --repo thinkwork-ai/thinkwork \
  --ref main \
  -f operation=wire-workflow \
  -f wire_dry_run=false \
  -f apply_confirmation="APPLY TWENTY THINKWORK APP" \
  -f twenty_workflow_id="<workflow-id>" \
  -f twenty_workflow_step_id="<http-request-step-id>" \
  -f twenty_create_draft=true \
  -f trigger_stage=Customer \
  -f thinkwork_event=opportunity.stage.customer \
  -f workflow_key=customer_onboarding
```

Publish or activate the draft in Twenty if required by the Twenty workflow UI.

## Verification

The reopened THNK-33 gate passes only when all of the following are true:

- Twenty Applications shows native app `ThinkWork` as installed, not only OAuth
  app rows.
- The installed app has a `Settings` tab.
- The `Settings` tab saves `THINKWORK_TRIGGER_STAGE=Customer` and the
  `THINKWORK_WEBHOOK_URL`.
- The Customer-stage workflow action is `ThinkWork -> ThinkWork Webhook`, not
  Twenty's built-in `HTTP_REQUEST`.
- Moving a test Opportunity to `Customer` creates a ThinkWork webhook delivery
  with `source=twenty-app`.

Record the GitHub run URL, app UI screenshot, workflow screenshot, and
`source=twenty-app` delivery id in Linear before advancing THNK-33.
