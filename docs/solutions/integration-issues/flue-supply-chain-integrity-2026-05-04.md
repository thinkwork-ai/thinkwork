---
title: Flue runtime supply-chain integrity — CVE response SLA, trust tiers, and graceful degradation
date: 2026-05-04
category: docs/solutions/integration-issues/
module: agentcore-flue
problem_type: integration_issue
component: supply_chain
severity: medium
applies_when:
  - Bumping a version on @mariozechner/pi-agent-core, @mariozechner/pi-ai, or @modelcontextprotocol/sdk
  - A CI run reports `integrity mismatch` from scripts/verify-supply-chain.sh
  - A CVE is filed against any of the trusted-handler critical-path packages
  - A transitive dependency loses provenance (maintainer change, signing rotation, npm registry takedown)
related:
  - docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md
  - .github/workflows/supply-chain.yml
  - scripts/verify-supply-chain.sh
  - scripts/supply-chain-baseline.txt
tags:
  - flue
  - supply-chain
  - fr-3a
  - cve-response
  - upgrade-review
---

# Flue runtime supply-chain integrity — CVE response SLA, trust tiers, and graceful degradation

## Problem

Plan §005 FR-3a treats the Flue trusted handler as a security boundary: it brokers per-user OAuth bearers, signs completion callbacks with `API_AUTH_SECRET`, and arbitrates which agent tools touch tenant data. Any package on its critical path that ships a malicious version compromises every tenant's invocation. `pnpm install --frozen-lockfile` enforces lockfile integrity for every install, but a hand-edited lockfile or a fast-moving upgrade PR can re-pin a package without a maintainer noticing the rotation. We need a second gate: an explicit allow-list of the upstream agent-runtime packages with their pinned SHA512 hashes, plus a documented response procedure for the cases where that gate fires.

## Trust tiers

The supply-chain baseline (`scripts/supply-chain-baseline.txt`) covers the three packages on the trusted-handler critical path. Each tier has a different default response when an upgrade or CVE alert lands.

### Tier 1 — Manual upgrade-review gate

**Packages:** `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`

These are the agent-loop substrate (Mario Zechner's Pi runtime). Every version bump must:

1. Open a PR that updates `package.json` AND `scripts/supply-chain-baseline.txt` in the same diff.
2. Link to the upstream changelog or commit list for the version range being applied.
3. Get a named-reviewer approval from a platform engineer who confirmed the diff against the upstream commits.
4. Run the full CI matrix (lint, typecheck, test, supply-chain, deploy preview) before merge.

Lockfile integrity is the wire-level gate, but the upgrade-review gate is what stops a "Mario rotated his signing key" or "Mario's npm token was leaked" attack from sailing through on autopilot.

### Tier 2 — Lockfile integrity primary

**Packages:** `@modelcontextprotocol/sdk`

The MCP client is widely used by the broader Anthropic ecosystem; CVE coverage is reasonable, and the package's behaviour is mostly transport plumbing. Lockfile integrity is the primary gate; standard CVE response (Tier-2 SLA below) applies. A version bump does not require named-reviewer approval, but the same baseline-bump-in-same-PR rule applies.

### Tier 3 — Lockfile integrity only

Every other package in `pnpm-lock.yaml`. `pnpm install --frozen-lockfile` is the full control. No baseline entries; no upgrade-review gate. If a Tier-3 package is later promoted to Tier 1 or 2 (e.g., we add a direct dependency on it that lands on the trusted-handler critical path), update this doc and `scripts/supply-chain-baseline.txt` together.

## CVE response SLA

When a CVE lands against a Tier-1 or Tier-2 package, the platform on-call engineer is responsible for the response.

| Severity | Target response time | Action |
|---|---|---|
| Critical (CVSS 9.0+) | 4 hours | Pin the integrity hash to the patched version; ship a hotfix PR. If no patch exists, soft-pin to the last-known-good version with a posted incident note. |
| High (CVSS 7.0-8.9) | 24 hours | Same as Critical. |
| Medium (CVSS 4.0-6.9) | 48 hours | Patch via the normal upgrade-review gate. |
| Low (CVSS < 4.0) | Next sprint | Bundle with the next planned upgrade. |

### FR-1 / FR-3 carveout

If the CVE workaround requires modifying Flue source (because the upstream package has not patched and we need to ship), this is permitted as an exception to FR-1 ("no Flue forks") and FR-3 ("no Flue source modification"), provided:

1. The patch is submitted upstream concurrently with the local fix (open the PR / file the issue before merging the local patch).
2. The local fork retires within **30 days** of upstream acceptance OR within **90 days** of upstream NACK, whichever comes first.
3. The retirement deadline is tracked in this document (append to the section below) and revisited at every weekly platform sync until cleared.

### Active carveouts

_None as of 2026-05-04._

## Graceful degradation

Some failure modes are not malicious but still trigger `verify-supply-chain.sh` — the most common are an upstream package losing provenance (maintainer change, signing rotation, registry takedown). The graceful path:

1. **Hard-fail in CI.** The supply-chain workflow already does this; any drift surfaces as `integrity mismatch` with both hashes printed.
2. **Soft-pin to last-known-good.** If the upstream re-publish is delayed (e.g., maintainer is mid-handover), commit the *previous* integrity hash to `scripts/supply-chain-baseline.txt` with a `# soft-pin: ...` comment naming the incident and the expected restoration date. CI passes; the team has a documented incident to track.
3. **Restore once upstream re-publishes.** Replace the soft-pin with the current upstream hash and remove the comment in the same PR that bumps the version.
4. **Escalate** if the soft-pin is older than 30 days; either the package is genuinely abandoned (in which case we plan a migration) or the upstream rotation is in trouble (in which case we may need to fork — see the FR-1/FR-3 carveout).

## RACI

| Role | Responsibility |
|---|---|
| **Responsible** | Any platform engineer can author a soft-pin PR and post the incident note in `#eng-platform`. |
| **Accountable** | The platform on-call engineer for the week is accountable for any active incident; CVE SLA timers run from their pager. |
| **Consulted** | Tier-1 upgrade-review approver. Cannot be the same person who authored the bump PR. |
| **Informed** | `#eng-platform` Slack channel. Soft-pin PRs MUST include a one-line summary in the channel within 1 business hour of merging. |

## Verification

CI runs `bash scripts/verify-supply-chain.sh` on every PR + push to main via `.github/workflows/supply-chain.yml`. Local verification:

```bash
bash scripts/verify-supply-chain.sh
```

A passing run prints `verify-supply-chain: OK — verified N package(s)`. A failing run prints `integrity mismatch` with both hashes and a pointer back to this document.

## References

- `docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md` (FR-3a, U10)
- `.github/workflows/supply-chain.yml`
- `scripts/verify-supply-chain.sh`
- `scripts/supply-chain-baseline.txt`
- pnpm lockfile integrity docs: <https://pnpm.io/cli/install#--frozen-lockfile>
