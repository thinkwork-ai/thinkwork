# Compliance module documentation

The compliance module is an append-only audit-event log with WORM-anchored Merkle chain and async export, designed for SOC2 Type 1 walkthroughs. Master plan: [`docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`](../plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md).

## Where to read

| Doc | Audience | Read when |
|-----|----------|-----------|
| [overview.md](./overview.md) | Anyone new to the module | You need the 5-minute version |
| [architecture.md](./architecture.md) | Developers, auditors | You need to see how the pieces connect |
| [operator-runbook.md](./operator-runbook.md) | Operators | You need to do something to the running system |
| [auditor-walkthrough.md](./auditor-walkthrough.md) | Auditors, operators preparing for SOC2 | You need to demonstrate compliance to a third party |
| [developer-guide.md](./developer-guide.md) | Developers extending the module | You need to add a new event type or wire a new emit site |
| [oncall.md](./oncall.md) | On-call | An alarm fired |
| [changelog.md](./changelog.md) | Anyone tracing history | You need to know which PR shipped which capability |

## Maintenance

Append a row to [`changelog.md`](./changelog.md) when shipping new compliance work. The other docs update on the cadence the master arc evolves; the operator runbook and on-call notes especially benefit from quarterly review against alarms actually fired in production.
