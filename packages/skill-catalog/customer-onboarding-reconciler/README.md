# customer-onboarding-reconciler

Reconciler-shaped composition that drives a new customer from opportunity-won
to onboarded via re-entrant ticks. Webhook anchor for the composable-skills
plan's D7a (reconciler contract) and D7b (webhook as invocation path).

See `SKILL.md` for the full runbook.

## When this composition runs

- **First tick:** CRM fires an `opportunity.won` event →
  `POST /webhooks/crm-opportunity/{tenantId}` → `customer-onboarding-reconciler`
  kicks off → reads existing state (typically empty) → creates the initial task
  set → exits.
- **Subsequent ticks:** a task created by a prior tick gets marked done →
  task system fires `POST /webhooks/task-event/{tenantId}` with the prior
  run's id → re-invoke same skill + same inputs → read current state → create
  only the tasks still missing.

## Adoption criterion (R13 — reconciler shape)

From the plan:

> ≥1 complete reconciler loop runs end-to-end against a real CRM
> opportunity-won event within 4 weeks (webhook received → tasks created
> + clarification task posted → at least one clarification task completed
> by the agent owner → re-tick observed in run history → no duplicate tasks
> created). This is the concrete falsification test for the reconciler
> contract (D7a) and the webhook ingress pattern (D7b).

The `reconciler-hitl-loop` integration test (Unit 8) is the in-repo proxy
for this criterion — it runs the full tick sequence with mocked
connectors and a stub task system, asserts no duplicate creates, and runs
on every PR.
