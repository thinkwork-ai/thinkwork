# Brain v0 Dogfood

## Week 0 Entry Criteria

- Dogfood rep identified and consenting.
- Brain-write enabled only for the dogfood tenant.
- At least five `tenant_entity_pages` rows seeded for the rep's book.
- Push notifications verified on the rep's actual device.
- `scripts/post-deploy/brain-v0-smoke.sh` passes.

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
