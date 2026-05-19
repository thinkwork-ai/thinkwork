---
title: Customer Onboarding Space Runbook
date: 2026-05-19
status: active
---

# Customer Onboarding Space Runbook

This runbook packages the v1 Spaces proof: a LastMile CRM closed-won webhook starts a Customer Onboarding Thread, mirrors the Space checklist into LastMile Tasks, subscribes the coordinator agent, and keeps humans in the Thread as the durable collaboration record.

## Seed a Tenant

Run the seed against a dev or stage database. Do not run it against production outside the normal release/ops approval path.

```sh
DATABASE_URL="$DATABASE_URL" \
TENANT_ID="<tenant-uuid>" \
COORDINATOR_AGENT_SLUG="coordinator" \
OWNER_USER_ID="<owner-user-uuid>" \
ROLE_ASSIGNEES_JSON='{"sales":{"externalId":"lm-sales","displayName":"Sales"},"accounting":{"externalId":"lm-accounting","displayName":"Accounting"},"finance":{"externalId":"lm-finance","displayName":"Finance"},"operations":{"externalId":"lm-ops","displayName":"Operations"}}' \
LASTMILE_WRITEBACK_POLICY="status_only" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts
```

Use `--dry-run` first to inspect the exact Space prompt, checklist, and LastMile integration config without mutating the database.

```sh
TENANT_ID="<tenant-uuid>" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts --dry-run
```

The script is idempotent. It upserts:

- `spaces` row with slug `customer-onboarding` and template key `customer_onboarding`
- checklist template `customer-onboarding-v1`
- checklist items for DocuSign, sales tax exemption, ERP setup, credit report, and kickoff review
- `lastmile_tasks` integration with the configured writeback policy
- Space membership for all tenant users unless `MEMBER_USER_IDS` or repeated `--member-user-id` values are supplied
- coordinator `space_agent_assignments` row for `COORDINATOR_AGENT_ID` or the agent slug from `COORDINATOR_AGENT_SLUG`

## Webhook Secret

Create or rotate the HMAC signing secret for LastMile CRM:

```sh
scripts/smoke/webhook-secret-put.sh <tenant-id> crm-opportunity
```

Configure LastMile CRM to POST closed-won opportunity events to:

```text
https://<api-host>/webhooks/crm-opportunity/<tenant-id>
```

Required payload fields:

- `event`: `opportunity.won` or `opportunity.closed_won`
- `opportunityId`
- either `customerId`, `customerName`, or `companyName`

Recommended payload fields:

- `opportunityUrl`
- `salesRep`
- `contacts`
- `dealValue`
- `productPlan` or `product` plus `plan`
- `closeDate`
- `documents`
- `notes`
- `specialRequirements`

## Smoke Test

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration crm-opportunity \
  --payload scripts/smoke/fixtures/crm-opportunity-won.json
```

Expected response:

```json
{
  "threadId": "<uuid>",
  "idempotent": false,
  "linkedTaskCount": 5,
  "missingFields": []
}
```

Rerunning the same fixture should return the same Thread with `idempotent: true` and `linkedTaskCount: 0`.

## Verify

```sql
SELECT id, slug, name, template_key, status
FROM spaces
WHERE tenant_id = '<tenant-id>' AND slug = 'customer-onboarding';

SELECT t.id, t.identifier, t.title, t.space_id, t.metadata
FROM threads t
WHERE t.tenant_id = '<tenant-id>'
  AND t.metadata->'customerOnboarding'->>'opportunityId' = 'smoke-opp-0001';

SELECT title, status, sync_status, external_task_id, external_task_url
FROM linked_tasks
WHERE tenant_id = '<tenant-id>' AND thread_id = '<thread-id>'
ORDER BY created_at;
```

## Rollback

For a bad seed in dev/stage, archive the Space instead of deleting rows:

```sql
UPDATE spaces
SET status = 'archived', updated_at = now()
WHERE tenant_id = '<tenant-id>' AND slug = 'customer-onboarding';
```

Do not delete linked task rows after a webhook smoke unless the external LastMile task cleanup has also been handled. ThinkWork treats LastMile Tasks as the system of record, so database cleanup alone can create confusing external state.
