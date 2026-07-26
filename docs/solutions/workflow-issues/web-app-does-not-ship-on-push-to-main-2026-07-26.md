---
module: .github/workflows
date: 2026-07-26
last_updated: 2026-07-26
category: workflow-issues
problem_type: process_gap
component: ci
severity: high
related_components:
  - deploy_workflow
  - release_desktop_workflow
  - web
applies_when:
  - "Shipping an apps/web change and expecting the merge to main to deploy it"
  - "A deploy run is green but the browser still shows the old UI"
  - "Verifying that a deployed environment actually serves the code you merged"
  - "Reasoning about which environments track main and which track a tag"
tags:
  - deploy
  - github-actions
  - web
  - verification
  - silent-skip
---

# The web app does not ship on a push to main

## Context

`deploy.yml` runs on every push to `main` with `STAGE: dev`, and it is easy to
read that as "merging deploys dev." It does — for Lambdas, Terraform, docs, and
workspace defaults. It does **not** deploy `apps/web`.

The workflow says so, in a comment that is 2000 lines into the file and attached
to no job:

```yaml
# NOTE: the web app (apps/web → app.thinkwork.ai) is intentionally NOT
# deployed on every push to main. It now ships only when a desktop release is
# cut (release-desktop.yml on a `desktop-v*` tag), so the web app and the
# desktop app always update together.
```

The pairing is deliberate: `app.thinkwork.ai` and the desktop app share a
build, and shipping them apart would let the two drift.

## What this looks like when it bites

Merging a web-only change produces a **fully green deploy run**. Every job that
runs, succeeds. Nothing is skipped in a way that reads as a warning:

```
Detect Changes: success        Build Lambdas: success
Terraform Apply: success       Migration Drift Check: success
Deploy Summary: success
```

There is no `Deploy Web` job in that list — not skipped, absent. The `changes`
job even computes a `web` output from an `apps/web/**` paths filter:

```yaml
web: ${{ steps.filter.outputs.web }}
```

and **nothing in the workflow consumes it**. So the filter fires, the output is
set, and no job reads it. A reader checking "did the web filter trigger?" gets a
yes that means nothing.

Meanwhile the browser keeps serving the previous bundle, and the environment's
`releaseVersion` keeps reporting the last `desktop-v*` tag — which looks like a
stale-cache problem rather than a never-deployed problem.

## Why the usual checks miss it

A green deploy plus a served page that renders fine gives two false positives at
once. The specific traps:

- **The run is green.** There is no failure to investigate.
- **`releaseVersion` is plausible.** It reports a real release, just an older
  one. On 2026-07-26 dev reported `v0.1.0-canary.407` while `main` was nine
  releases ahead — which reads as "slightly behind" rather than "web never
  deploys from main."
- **Lambda changes in the same PR _do_ land**, because `packages/api/**` is in
  the `lambdas` filter. A full-stack PR half-deploys, and the API half working
  makes the UI half look like a caching or build issue.

## How to actually check

Compare the environment's asset bucket against the clock. Content-addressed
chunk names mean a real deploy rewrites objects; nothing to rewrite means
nothing shipped.

```bash
aws s3api list-objects-v2 --bucket <env>-computer --prefix assets/ \
  --query "Contents[].LastModified" --output json \
| python3 -c "
import json,sys,collections
d=json.load(sys.stdin); c=collections.Counter(x[:13] for x in d)
print('assets:', len(d))
for k,n in sorted(c.items())[-3:]: print(' ', k, n)
"
```

On 2026-07-26, after a green dev deploy, every one of dev's 775 objects still
carried the previous day's timestamp — matching the last `desktop-v*` release
to the minute. That is the tell.

Then confirm the bytes actually contain the change. Pick a string that exists
only in the new code — an `aria-label`, a `data-testid`, a user-visible
sentence — and grep the freshly written chunks:

```bash
aws s3api list-objects-v2 --bucket <env>-computer --prefix assets/ \
  --query "Contents[?starts_with(LastModified,'<today>T<hour>')].Key" --output json
# then fetch those keys and grep for the marker
```

Two notes from doing this:

- **App code lands in a chunk named `mermaid-*.js`.** The name comes from
  chunk-splitting, not content. Do not skip it.
- **Chunk hashes differ per environment** because each build bakes its own env
  values. dev served `mermaid-GHXKKRXX-C8VGL8DW.js` where McPherson and TEI both
  served `mermaid-GHXKKRXX-eZGJlR6K.js` — same code, different hash. Match on
  content, never on filename.

## Shipping a web change

| Target                         | Mechanism                                        |
| ------------------------------ | ------------------------------------------------ |
| dev — Lambdas, Terraform, docs | push to `main` (`deploy.yml`)                    |
| dev — web app                  | tag `desktop-v<version>` (`release-desktop.yml`) |
| Customer environments          | deployment orchestrator at a `v*` release        |

A web change therefore needs **two** tags in the normal flow: `v<version>` for
the platform release that customer orchestrators consume, and
`desktop-v<version>` for `app.thinkwork.ai` plus the desktop build. Cutting only
the first leaves dev behind while customer environments move ahead — the
inverse of what most people expect.

Customer environments are not affected by this gap: their orchestrators deploy
static assets out of the release bundle, so a `v*` release carries the web app
to them.

## Related

- `docs/solutions/ui-bugs/inline-citations-shipped-inert-twice-2026-07-25.md` —
  the same lesson one layer up: a feature that deployed correctly and did
  nothing, found only by reading the deployed bundle and the rendered DOM. The
  habit that catches both is "verify served bytes, never deploy status."
