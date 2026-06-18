# ThinkWork Twenty App

Native Twenty app source for the THNK-33 workflow path:

```text
Twenty workflow -> ThinkWork app -> ThinkWork Webhook
```

The app exposes one workflow action, `ThinkWork Webhook`. The action compares
the incoming Twenty Opportunity stage with the configured app stage and only
posts to the configured ThinkWork generic webhook URL when they match.

## Configuration

After installing the app, open Twenty:

```text
Settings -> Applications -> Installed -> ThinkWork -> Settings
```

Set the app variables:

| Variable                  | Required | Default    | Description                                                                                                                            |
| ------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `THINKWORK_WEBHOOK_URL`   | yes      | none       | Full ThinkWork generic webhook URL copied from ThinkWork Settings > Webhooks, for example `https://app.thinkwork.ai/webhooks/<token>`. |
| `THINKWORK_TRIGGER_STAGE` | yes      | `Customer` | Twenty Opportunity stage label that should trigger the ThinkWork webhook.                                                              |

The webhook URL contains the ThinkWork webhook token, so it is declared as a
secret application variable and is only available to the server-side logic
function. The trigger stage is intentionally editable in the app settings so the
mapping stays in Twenty's ThinkWork app configuration.

## Workflow Wiring

In the Twenty workflow builder, call the app action when an Opportunity stage
changes. The stage gate lives in the ThinkWork app settings rather than in a
custom Lambda or a hard-coded workflow name.

```text
Opportunity stage webhook workflow
  Trigger: opportunity.updated on stage
  Action: ThinkWork -> ThinkWork Webhook
```

Recommended action input mapping:

| Input             | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| `event`           | optional; defaults to `opportunity.stage.customer`      |
| `opportunityId`   | Current Opportunity record id                           |
| `opportunityName` | Current Opportunity name                                |
| `companyName`     | Current Opportunity company/account name when available |
| `stage`           | Current Opportunity stage                               |
| `opportunityUrl`  | Current Opportunity URL when available                  |
| `workflowKey`     | `customer_onboarding`                                   |
| `workflowRunId`   | Current workflow run id when available                  |
| `occurredAt`      | Workflow run timestamp or current timestamp             |
| `idempotencyKey`  | Stable key such as `stage-customer:<opportunity-id>`    |

The logic function sends those fields to ThinkWork with
`source: "twenty-app"` and `triggerStage: "<configured stage>"` when the
incoming stage matches `THINKWORK_TRIGGER_STAGE`. If the stage does not match,
the action returns `status: "skipped_stage"` and does not call ThinkWork.

ThinkWork should record the resulting generic webhook delivery with
`source=twenty-app`, `stage=Customer`, and `triggerStage=Customer`, proving that
the path goes through the installed Twenty app settings.

## Install / Sync

Do not run these commands against production from an implementation PR. They
mutate the target Twenty instance.

```bash
cd plugins/twenty/twenty-app
corepack enable
yarn install
yarn twenty remote:add thinkwork-crm https://crm.thinkwork.ai
yarn twenty dev --once --dry-run
yarn twenty dev --once
```

After sync, the Twenty Applications screen should show a native installed app
named `ThinkWork`, and the workflow builder should offer a workflow action
named `ThinkWork Webhook`.
