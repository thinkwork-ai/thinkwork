# ThinkWork Twenty App

Native Twenty app source for the THNK-33 workflow path:

```text
Twenty workflow -> ThinkWork app -> ThinkWork Webhook
```

The app exposes one workflow action, `ThinkWork Webhook`. The action posts a
workflow event to the configured ThinkWork generic webhook URL and forwards a
stable `x-idempotency-key` so ThinkWork can deduplicate retries.

## Configuration

After installing the app, open Twenty:

```text
Settings -> Applications -> Installed -> ThinkWork -> Settings
```

Set the secret environment variable:

| Variable                | Required | Description                                                                                                                            |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `THINKWORK_WEBHOOK_URL` | yes      | Full ThinkWork generic webhook URL copied from ThinkWork Settings > Webhooks, for example `https://app.thinkwork.ai/webhooks/<token>`. |

The URL contains the ThinkWork webhook token, so it is declared as a secret
application variable and is only available to the server-side logic function.

## Workflow Wiring

In the Twenty workflow builder, use the app action instead of the built-in HTTP
request action:

```text
Closed Won workflow
  Trigger: opportunity.updated on stage
  Filter: stage == CUSTOMER
  Action: ThinkWork -> ThinkWork Webhook
```

Recommended action input mapping:

| Input             | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| `event`           | `opportunity.won`                                        |
| `opportunityId`   | Current Opportunity record id                            |
| `opportunityName` | Current Opportunity name                                 |
| `companyName`     | Current Opportunity company/account name when available  |
| `stage`           | Current Opportunity stage                                |
| `opportunityUrl`  | Current Opportunity URL when available                   |
| `workflowKey`     | `customer_onboarding`                                    |
| `workflowRunId`   | Current workflow run id when available                   |
| `occurredAt`      | Workflow run timestamp or current timestamp              |
| `idempotencyKey`  | Stable key such as `closed-won:<opportunity-id>:<stage>` |

The logic function sends those fields to ThinkWork with
`source: "twenty-app"` and the configured webhook URL. ThinkWork should record
the resulting generic webhook delivery with `source=twenty-app` rather than
`source=twenty-workflow`, proving that the path goes through the installed
Twenty app.

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
