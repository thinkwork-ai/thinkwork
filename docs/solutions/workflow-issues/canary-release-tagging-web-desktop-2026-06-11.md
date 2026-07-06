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
  - Running browser-based dogfood/UI verification right after a web-facing PR
    merges to main and the change doesn't appear to have taken effect
tags: [release, canary, desktop, web, tags, app-thinkwork-ai, github-actions, dogfood, verification]
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
6. **This recurs every time browser-based verification follows a merge.**
   THINK-178 (rename Pin → Snapshot) hit it twice within the same issue —
   once needing a "Needs User" round-trip to get a canary cut before the
   four browser flows (S1-S5) could even be attempted — and THINK-180 hit it
   independently the same day. The pattern each time: GraphQL/Lambda changes
   are live within minutes of merge, so backend checks pass immediately;
   the web bundle (`app.thinkwork.ai`) does not update until a human pushes
   a `desktop-v0.1.0-canary.N` tag, so browser verification of the same PR
   can silently be exercising stale JS with no error to signal it. Detect it
   before spending time debugging "why doesn't the browser show my change":
   `curl -sI https://app.thinkwork.ai/ | grep -i last-modified` (or check the
   app's `releaseVersion` against `git log -1 --format=%cI origin/main` for
   the merge commit) — if the bundle predates the merge, browser verification
   is blocked pending a new `desktop-v*` tag, not a code problem. Escalate to
   a human to cut the tag (tag-pushing is a release action outside dogfood
   scope) rather than looping on cache-busting or re-deploying.

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
