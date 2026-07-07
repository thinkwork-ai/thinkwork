---
eyebrow: SUPPORT REPORT
date: 2026-07-06
context: June intake review
---

## Summary

This month brought **127 tickets** across five high-volume buckets. Login failures dominate (42 tickets, 33% of volume), followed by billing questions (30, 24%) and dashboard slowness (25, 20%). Mobile crashes and CSV export errors round out the list, each in the teens.

The pattern suggests a concentration of friction around **access** and **experience** — users struggle to get in, then perceive latency once they do. Export failures are lowest volume but likely block critical workflows.

```tw:stats
items:
  - { value: 127, label: total tickets }
  - { value: 42, label: login failures }
  - { value: 30, label: billing questions }
```

## Ticket Volume by Category

| Category | Tickets | Share of Volume |
|----------|---------|-----------------|
| Login failures | 42 | 33% |
| Billing questions | 30 | 24% |
| Slow dashboard | 25 | 20% |
| Mobile app crashes | 18 | 14% |
| CSV export errors | 12 | 9% |

```tw:chart
type: funnel
title: Ticket concentration by issue
series:
  - { label: Login failures, value: 42 }
  - { label: Billing questions, value: 30 }
  - { label: Slow dashboard, value: 25 }
  - { label: Mobile crashes, value: 18 }
  - { label: CSV export errors, value: 12 }
caption: Login failures are the single largest ticket category — a likely friction point for user entry.
```

## What's Driving the Load

### Access & Authentication (Login Failures)
- 42 tickets — single largest contributor
- Likely sources: credential reset loops, SSO misconfigurations, session expiry edge cases
- **Impact**: Blocks entry entirely; high frustration, high escalation risk

### Commercial Friction (Billing)
- 30 tickets — routine but persistent
- Pattern likely includes invoicing timing, payment method updates, and renewal confusion
- **Impact**: Moderate severity, but volume keeps the queue full

### Performance (Dashboard & Mobile)
- Slow dashboard (25) and mobile crashes (18) total **43 tickets**
- Likely interconnected: backend latency manifests differently on web vs. native clients
- **Impact**: Attrition risk if users perceive the product as "slow" or "unstable"

### Data Operations (CSV Export)
- 12 tickets — small volume relative to others
- **Impact**: Often batch or compliance-critical; downtime here can have outsized business consequences

## Where Attention Is Needed

```tw:verdict-grid
cards:
  - { question: Investigate login failures, answer: Yes, note: 33% of volume — the biggest lever, tone: acc }
  - { question: Engage engineering on performance, answer: Yes, note: Dashboard + mobile need deep look, tone: acc }
  - { question: Self-service for billing, answer: Evaluate, note: High volume, potentially deflectable, tone: info }
  - { question: Export reliability review, answer: Yes, note: Low volume but high blast radius, tone: info }
```

## Next Steps

1. **Login failure deep-dive** — Pull logs for the 42 cases; categorize root causes (auth, session, SSO)
2. **Performance baseline** — Instrument dashboard load times and crash telemetry; set SLO targets
3. **Billing deflection** — Review ticket transcripts for common questions; update help articles or in-app guidance
4. **Export health check** — Confirm recent changes to export pipeline; validate large-dataset handling

---

*Document status: Draft — ready for review and share.*

