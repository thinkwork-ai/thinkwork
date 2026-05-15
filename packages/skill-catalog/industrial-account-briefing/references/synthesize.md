# Synthesize Operator Signals

Convert the discovered evidence into an executive operator briefing dataset. The goal is to help an operator decide where attention is needed today.

## Synthesis Priorities

Rank findings in this order:

1. **Material account changes:** revenue, margin, order volume, pricing, or product mix movement.
2. **Relationship gaps:** important accounts with stale CRM activity, missing owner follow-up, or open opportunities without next steps.
3. **Operational constraints:** fleet, service, delivery, maintenance, or capacity signals that affect customer promises.
4. **Cross-system contradictions:** ERP says declining while CRM says healthy; CRM says opportunity is active while fleet capacity is constrained; sales assumptions conflict with service availability.
5. **Recommended next actions:** concrete operator follow-ups such as ask branch manager, review pricing, inspect capacity, contact account owner, or open an investigation.

## Evidence Rules

- Every material claim must cite the source family and record group.
- Use "unavailable" or "not supported by current sources" when evidence is missing.
- Do not infer customer sentiment from revenue alone.
- Do not infer fleet capacity unless fleet-management records support it.
- Separate facts from recommendations.

## Briefing Dataset Shape

Create a structured dataset compatible with `assets/industrial-account-briefing-data.schema.json`:

- `sourceCoverage`
- `accounts`
- `operatorSignals`
- `contradictions`
- `recommendedActions`
- `sourceNotes`

Keep it compact. The executive operator needs a decision surface, not a data dump.
