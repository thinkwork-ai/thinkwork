---
title: Customer Onboarding Space Runbook
date: 2026-05-19
status: active
---

# Customer Onboarding Space Runbook

This runbook packages the native v1 Spaces proof: a user starts a Customer Onboarding Thread, ThinkWork creates checklist rows from the Space template, and humans work the checklist in the Thread until a human marks the Thread complete.

LastMile CRM/Tasks, DocuSign, Dun & Bradstreet, credit, tax-form, and P21 integrations are phase-two work. For the initial demo, those systems are manual ThinkWork checklist steps.

## Seed a Tenant

Run the seed against a dev or stage database. Do not run it against production outside the normal release/ops approval path.

```sh
DATABASE_URL="$DATABASE_URL" \
TENANT_ID="<tenant-uuid>" \
OWNER_USER_ID="<owner-user-uuid>" \
ROLE_ASSIGNEES_JSON='{"sales":{"displayName":"Sales"},"accounting":{"displayName":"Accounting"},"finance":{"displayName":"Finance"},"operations":{"displayName":"Operations"}}' \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts
```

Use `--dry-run` first to inspect the exact Space prompt, checklist, Space source files, and optional phase-two integration config without mutating the database.

```sh
TENANT_ID="<tenant-uuid>" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts --dry-run
```

To update the existing demo Space instead of resolving by slug, pass its ID:

```sh
DATABASE_URL="$DATABASE_URL" \
TENANT_ID="<tenant-uuid>" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts \
  --space-id 0b640386-05d7-4dbb-9585-e4c0b8c03f5f
```

The script is idempotent. It upserts:

- `spaces` row with slug `customer-onboarding`, kind `customer_onboarding`, and template key `customer_onboarding`
- checklist template `customer-onboarding-v1`
- ThinkWork-native checklist items for DocuSign, Dun & Bradstreet, credit check, tax exemption forms, P21 setup, missing information, and final review
- Space membership for all tenant users unless `MEMBER_USER_IDS` or repeated `--member-user-id` values are supplied

Coordinator wakeups use the tenant platform agent. The old `space_agent_assignments` table is no longer part of the seed path.

## Seed Space Source Files

The v1 Space uses ICM-style source files:

- `CONTEXT.md` is the operating contract.
- `docs/customer-onboarding-intake.md` holds the editable intake questions and checklist rules.

To write those files to the Space source prefix, include `--write-space-files` and `WORKSPACE_BUCKET` after confirming the dry-run output:

```sh
DATABASE_URL="$DATABASE_URL" \
TENANT_ID="<tenant-uuid>" \
WORKSPACE_BUCKET="<workspace-bucket>" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts \
  --space-id 0b640386-05d7-4dbb-9585-e4c0b8c03f5f \
  --write-space-files
```

After writing files, use the Space Workspace tab's folder-structure refresh. The generated `## Folder Structure` should include `docs/customer-onboarding-intake.md` and should not expand `skills/` package trees.

## Optional Phase-Two LastMile Config

Only include LastMile integration config when deliberately testing the future external-task path:

```sh
DATABASE_URL="$DATABASE_URL" \
TENANT_ID="<tenant-uuid>" \
LASTMILE_WRITEBACK_POLICY="status_only" \
LASTMILE_PROJECT_ID="<lastmile-project-id>" \
pnpm exec tsx scripts/seed-customer-onboarding-space.ts \
  --include-lastmile-integration
```

This is not required for the native v1 demo.

## Native Demo Smoke

1. Open the Customer Onboarding Space in the Spaces app.
2. Start onboarding manually.
3. Answer the intake questions, including tax exemption and credit terms.
4. Confirm the Thread kickoff includes the customer facts and missing answers.
5. Confirm checklist rows appear for DocuSign, D&B, P21, final review, and conditional credit/tax work.
6. Mark required checklist rows complete.
7. Mark the Thread `DONE` after human review.

## Verify

```sql
SELECT id, slug, name, template_key, status
FROM spaces
WHERE tenant_id = '<tenant-id>' AND slug = 'customer-onboarding';

SELECT key, title, required, external_task_template
FROM space_checklist_items
WHERE tenant_id = '<tenant-id>' AND space_id = '<space-id>'
ORDER BY sort_order;

SELECT t.id, t.identifier, t.title, t.status, t.space_id, t.metadata
FROM threads t
WHERE t.tenant_id = '<tenant-id>'
  AND t.space_id = '<space-id>'
ORDER BY t.created_at DESC
LIMIT 5;
```

## Rollback

For a bad seed in dev/stage, archive the Space instead of deleting rows:

```sql
UPDATE spaces
SET status = 'archived', updated_at = now()
WHERE tenant_id = '<tenant-id>' AND slug = 'customer-onboarding';
```

Do not run production mutations manually. Production changes should flow through the normal merge/deploy path and approved operational process.
