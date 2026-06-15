# Brain v0 Dogfood

## Week 0 Entry Criteria

- Dogfood rep identified and consenting.
- Brain-write enabled only for the dogfood tenant.
- At least five `tenant_entity_pages` rows seeded for the rep's book.
- Push notifications verified on the rep's actual device.
- `scripts/post-deploy/brain-v0-smoke.sh` passes.
- Company Brain is installed for the tenant and the plugin detail page links to
  **Brain operations**.
- `node plugins/company-brain/smoke/company-brain-operations-smoke.mjs` dry-run passes.
- `node plugins/company-brain/smoke/company-brain-context-engine-smoke.mjs` dry-run passes.

## Substrate Checks

Run the live operations smoke after the deploy pipeline finishes and before
starting the weekly dogfood cadence:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  SMOKE_MEMBER_USER_ID=<tenant-member-user-id> \
  node plugins/company-brain/smoke/company-brain-operations-smoke.mjs
```

Passing live mode means `companyBrainStatus` reports the current storage tier,
active read backend, health, counters, capabilities, and migration posture.
When `SMOKE_MEMBER_USER_ID` is set, the same smoke verifies that tenant member
reads do not expose operator evidence such as raw substrate endpoints, S3
roots, Neptune identifiers, or EFS identifiers.

Production migration is not part of the default dogfood smoke because it is a
state-changing operation. Only request it from the smoke when an operator has
confirmed the tenant is ready for production substrate replay:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS=1 \
  SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  node plugins/company-brain/smoke/company-brain-operations-smoke.mjs
```

The mutation path sends no request unless the tenant is ready on the default
tier and has no active migration. Rollback/failure updates remain operator
actions from the Brain operations UI, not part of the automated smoke.

## Context Engine Checks

Verify the customer-facing value path through ThinkWork Brain rather than
through raw substrate APIs:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_CONTEXT=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_USER_ID=<tenant-user-id> \
  SMOKE_COMPANY_BRAIN_CONTEXT_QUERY="Acme renewal risk" \
  SMOKE_COMPANY_BRAIN_EXPECTED_TERM="procurement" \
  node plugins/company-brain/smoke/company-brain-context-engine-smoke.mjs
```

Passing live mode means `query_brain_context` returns Company Brain context
through the Context Engine boundary, carries untrusted source-data metadata,
reports provider-local posture, and stays separate from Hindsight
`query_memory_context`.

## Weekly Cadence

- Monday: triage automation fires. PM reviews with the rep in week 1, then solo.
- Wednesday: rep triggers one one-pager for a real meeting.
- Friday: PM runs `brain-write-audit.ts` and `kb-promotion-audit.ts`.

## Metrics

- Triage engagement: target 4 of 4 weeks.
- Edit rate: below 30%.
- Reject rate: below 10%.
- Recurring-thread reuse: 100% found-vs-created from week 2 onward.
- New entity time-to-first-fact: adds under 1s to wakeup latency.

## Exit Criteria

- Metrics green for at least 3 of 4 weeks.
- Zero cross-tenant write attempts.
- Zero accidental KB-promotion writes while the seam is inert.
- Rep says they would miss it if removed.
- PM and engineering lead sign off; engineering lead may veto on safety.

## Failure Mode

If the rep has zero engagement after two weeks, do not broaden rollout based on
agent-side metrics. Diagnose whether the rep had no meeting traffic, the wedge
was not valuable, or delivery instrumentation failed.
