---
title: "Canary releases: manual v* tags, mirrored desktop-v* numbers, web ships with desktop"
date: 2026-06-11
last_updated: 2026-07-06
category: docs/solutions/workflow-issues/
module: release-engineering
problem_type: workflow_issue
component: release_pipeline
severity: high
applies_when:
  - Cutting a platform (web) or desktop release
  - Wondering why a new `v0.1.0-canary.N` release appeared "by itself"
  - A release is "missing web artifacts" or "missing desktop artifacts"
  - Deciding what number the next desktop tag should carry
  - Verifying a web-only (apps/web) fix on deployed dev/app.thinkwork.ai right
    after its PR merges to main
tags: [release, canary, desktop, web, tags, app-thinkwork-ai, github-actions]
---

# Canary releases: manual v* tags, mirrored desktop-v* numbers, web ships with desktop

## Context

ThinkWork has one shared canary number series (`0.1.0-canary.N`) consumed by
two tag-triggered workflows:

- `v0.1.0-canary.N` → `release.yml` — builds **platform artifacts**
  (`platform-artifacts.tar.gz` with all lambdas + `static/web.tar.gz` +
  `static/docs.tar.gz`, plus `thinkwork-release.json` manifest). This is what
  the deployment controller consumes to deploy ThinkWork web.
- `desktop-v0.1.0-canary.N` → `release-desktop.yml` — builds the macOS
  desktop app and publishes its assets **into the same `v0.1.0-canary.N`
  GitHub release**, and also ships the web app to app.thinkwork.ai.

## Non-obvious facts (each burned real time on 2026-06-11)

1. **Nothing auto-mints canary tags.** The releases are *authored by*
   `github-actions[bot]`, which looks like automation — but the bot only
   creates the release after a human/session pushes the `v*` tag. Waiting for
   "CI to mint the next canary" waits forever.
2. **Desktop tags must mirror the platform canary number on the same
   commit.** The desktop workflow publishes into the release named
   `v0.1.0-canary.N`. Tagging `desktop-v...N` for a number whose platform
   release already exists at a *different* commit attaches desktop assets to
   the wrong code.
3. **app.thinkwork.ai web only updates on desktop releases.** deploy.yml
   explicitly does NOT deploy apps/web on push to main ("web and desktop
   always update together" — see the NOTE near the docs job). Backend lambdas
   deploy on every main merge; the hosted web UI does not.
4. **A release can be "incomplete".** Platform-only (no .dmg) or desktop-only
   (no platform-artifacts.tar.gz) releases happen when only one tag was
   pushed or one workflow failed. Check
   `gh release view v0.1.0-canary.N --json assets` for BOTH asset families,
   and verify the manifest's `artifacts[]` contains the `web` static-site
   entry.
5. **GHCR login timeouts are transient.** `release.yml`'s "Login to GHCR"
   step occasionally dies with `Client.Timeout exceeded`;
   `gh run rerun <id> --failed` fixes it.

## Working recipe (cut a full web+desktop release)

```bash
# wait until no runs are active on main, last Deploy green, then:
git fetch origin main --tags
SHA=$(git rev-parse origin/main)
N=$(git tag -l 'v0.1.0-canary.*' | sed 's/.*canary\.//' | sort -n | tail -1)
NEXT=$((N+1))
git tag "v0.1.0-canary.$NEXT" "$SHA"
git tag "desktop-v0.1.0-canary.$NEXT" "$SHA"
git push origin "v0.1.0-canary.$NEXT" "desktop-v0.1.0-canary.$NEXT"
# watch both: release.yml + release-desktop.yml, then verify assets + manifest
```

## Gotchas

- `gh run list --jq` does not support jq's `--arg`; interpolate the value
  into the jq string instead.
- `gh release view desktop-v0.1.0-canary.N` is "not found" — desktop assets
  live on the `v0.1.0-canary.N` release (see
  memory: desktop release tag vs release name).

## Recurring gap: verifying an `apps/web`-only fix right after merge

This has now hit two dogfood-verification passes in one day — THINK-178
(stalled on it, went to Needs User) and THINK-180 (recognized it immediately
and proceeded without blocking). The pattern: a fix touches `apps/web` (or has
an `apps/web`-only piece, like a display-fallback regex), the PR merges to
main, and the merge's own Deploy run goes green — but fact #3 above means the
web bundle at `app.thinkwork.ai` did **not** change, because web only ships on
a `desktop-v*` canary tag. A verifier who doesn't already know fact #3 reads
"Deploy succeeded" and expects the web behavior to be live, then can't
reproduce it and stalls.

**Before dogfooding an `apps/web` change on deployed dev, check whether a
`desktop-v*` canary has been cut since the fix's commit landed:**

```bash
git fetch origin main --tags
LATEST_DESKTOP_TAG=$(git tag -l 'desktop-v0.1.0-canary.*' | sed 's/.*canary\.//' | sort -n | tail -1)
gh tag_commit=$(git rev-list -n1 "desktop-v0.1.0-canary.$LATEST_DESKTOP_TAG")
git merge-base --is-ancestor <fix-commit-sha> "$tag_commit" && echo "web-live" || echo "not yet on a canary"
```

If the fix's commit is not yet an ancestor of the latest `desktop-v*` tag's
commit, the web-only piece is **not deployed** — this is expected, not a
blocker, and not evidence the fix is broken:

- Scope verification to the parts of the fix that ship on every main merge
  (backend Lambdas, API resolvers, Pi runtime) via a deployed API call
  (GraphQL mutation/query) or backend-only browser observation, and say so
  explicitly in the dogfood report.
- Only escalate to Needs User if the *undeployed* web piece is load-bearing
  for the contract under test (e.g. the bug can't be proven fixed without it)
  — not merely because the web bundle hasn't refreshed yet.
- The gap self-heals on the next routine canary cut; no manual canary cut is
  owed to a single fix unless the web piece is genuinely blocking.

See
[THINK-180's diagnostic doc](../diagnostics/think-180-at-mention-agent-profile-delegation-2026-07-06.md)
and its
[dogfood report](../../dogfood-reports/2026-07-06-THINK-180-dogfood.md)
for a worked example of scoping verification around this gap without
stalling.
