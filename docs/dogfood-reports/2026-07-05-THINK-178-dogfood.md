---
date: 2026-07-05
linear_issue: THINK-178
scope: "PR #3399 (U1 — rename Living Canvas version-capture Pin → Snapshot)"
verdict: BLOCKED — backend verified live & correct; web UI flows unverifiable on deployed dev
---

# THINK-178 Dogfood Verification — rename artifact "Pin" → "Snapshot"

**Verdict: BLOCKED (needs a human decision).** The rename **code is correct**
and the **backend half is deployed and verified working** on dev: the
`snapshotArtifact` mutation is live, appends a version, and returns the bumped
`headVersion`; the old `pinArtifact` field is gone. **But the four
Verification-Contract browser flows cannot be run on deployed dev**, because
the web frontend (apps/web → app.thinkwork.ai) is **not** deployed by the
merge-to-main pipeline — it ships only when a `desktop-v*` canary tag is cut
(`release-desktop.yml`). No such release has been cut since the merge, so
app.thinkwork.ai still serves the pre-rename bundle. The plan's KTD3 / Rollout
Notes / Verification Contract assumed web + Lambda co-deploy on merge — that
assumption is factually wrong for this repo, and it also means the deployed
web's version-capture button currently calls the removed `pinArtifact`
(a bounded, dev-only break that self-heals on the next desktop canary).

**Target:** deployed dev (`app.thinkwork.ai` + GraphQL API
`ho7oyksms0.execute-api.us-east-1.amazonaws.com`), operator session (Eric,
Cognito Google-federated). Browser session authenticated by injecting
refreshed Cognito tokens (from the CLI dev session) into the app's
localStorage — interactive WorkOS/Google OAuth is not automatable here.

**Change under test:** PR #3399 (merged 2026-07-05T21:33:27Z, squash commit
`ca2da2bb2f11dddf93c6c7bf7d7222d1f58da3b1`). Renames the Living Canvas
version-capture concept from "Pin" to "Snapshot" across GraphQL API
(`pinArtifact` → `snapshotArtifact`, `pinHeadToVersion` →
`snapshotHeadToVersion`), web UI (canvas header button lucide `Pin` → Tabler
`IconCameraSpark`, title/aria "Snapshot", testid `canvas-pin` →
`canvas-snapshot`, toasts, "No snapshots yet…" empty state), version-chain
comments, and CONCEPTS.md. No behavior change; codegen regenerated in
web/mobile/cli. Diff reviewed against prior main (`gh pr diff 3399`) — clean,
matches the plan's Affected-Surface Inventory; R8 keep-list untouched;
document-domain pin vocab correctly deferred.

## Deploy reality (root cause of the block)

| Half | Deploys via | State on dev |
|---|---|---|
| GraphQL Lambda (`graphql-http`) — schema + resolvers | merge-to-main Deploy (`deploy.yml` → Terraform Apply) | **LIVE** — `snapshotArtifact` present, `pinArtifact` removed |
| Web app (`apps/web` → app.thinkwork.ai) | **`desktop-v*` tag only** (`release-desktop.yml` `build-web`) — `deploy.yml` L1875 NOTE | **STALE** — last web deploy `desktop-v0.1.0-canary.319` @ 17:40Z, **before** the 21:33Z merge |

Evidence the web is stale:
- `curl -sI https://app.thinkwork.ai/` → `last-modified: Sun, 05 Jul 2026
  17:40:40 GMT` (= canary.319's deploy, hours before the merge).
- Deployed app chunk `mermaid-GHXKKRXX-DWw-iDqp.js` (a shared app chunk)
  still contains `pinArtifact` (×2) and the string `"pinned versions"`.
- No `desktop-v*` canary cut since .319; none in progress at report time.

Evidence the backend is live and coherent (deployed GraphQL endpoint,
authenticated as Eric):
- `__type(name:"Mutation"){fields}` → `snapshotArtifact` **present**,
  `pinArtifact` **absent**.
- `mutation{ snapshotArtifact(artifactId:"70b3760f-…-945b"){ headVersion
  versions{version createdAt} } }` → HTTP 200, `headVersion 0 → 1`, new row
  `{version:1, createdAt:"2026-07-05T22:00:23.079Z"}` — proves AE1's mechanism
  (append content-addressed version) against the deployed Lambda. _(This
  mutated dev data by design — a non-destructive append-only snapshot; it
  advanced "Largest US States" from headVersion 0 to 1.)_
- `mutation{ pinArtifact(...) }` → `GRAPHQL_VALIDATION_FAILED` "Cannot query
  field \"pinArtifact\" on type \"Mutation\"" — confirms the deployed old web
  bundle's Pin button now targets a nonexistent field.

## Scenario matrix

Seeded from the handoff QA checklist (4 items) + the plan's Verification
Contract, extended with API-level and console-health ceiling scenarios.

| # | Scenario | Source | Expected | Functional | Experiential |
|---|----------|--------|----------|------------|--------------|
| S0a | Backend: `snapshotArtifact` appends a version | AE1 backend / R5 | Live mutation appends content-addressed version, bumps headVersion | **PASS** (0→1, persisted 22:00:23Z) | n/a |
| S0b | Backend: `pinArtifact` removed (no alias) | AE3 / R5 / KTD3 | Old field 404s on deployed API | **PASS** (GRAPHQL_VALIDATION_FAILED) | n/a |
| S1 | Snapshot empty state copy | QA #2 / VC #2 / R2,R3 | "No snapshots yet. A snapshot captures the current canvas as a read-only version." | **BLOCKED** — deployed web shows old "No pinned versions yet. Pinning a version snapshots the current canvas." (web not redeployed) | — |
| S2 | Snapshot capture (button icon + tooltip + toast + history + read-only view) | QA #1 / VC #1 / AE1 → R1,R2 | Camera-spark button "Snapshot"; toast "Snapshot saved (v N)"; history row; View read-only | **BLOCKED** — deployed web has no `canvas-snapshot` (and no `canvas-pin` on this route); button/copy/icon are old bundle | — |
| S3 | Favorite pin untouched | QA #3 / VC #3 / AE2 → R8 | Favorite pin + sidebar "Pinned" unchanged | **NOT REGRESSED** by code (diff leaves it untouched); sidebar "Pin thread" present in deployed web. UI re-confirm deferred with S1/S2 | — |
| S4 | Check-in auto-snapshot | QA #4 / VC #4 / R6 | Re-save appends a version | **PARTIAL/PASS (backend)** — same `snapshotHeadToVersion` helper proven by S0a; full check-out→edit→re-save UI path blocked with web | — |
| S5 | Console/network health | Ceiling — regression sweep | No console/GraphQL errors | **DEFERRED** with web deploy | — |

Green: S0a, S0b (backend). Blocked pending web deploy: S1, S2, S4 (UI path),
S5. S3 is untouched-by-design.

## Paper cuts

- None in the code under test. The one notable issue is not a paper cut but a
  process finding (see Decisions for a human): the plan mis-modeled the web
  deploy path.

## Decisions for a human

The rename itself is done and correct; the block is purely a deploy-model
mismatch. **Recommendation: Option A.**

- **Option A (Recommended) — cut the next desktop canary now.** Cut
  `desktop-v0.1.0-canary.320` off current `main`. `release-desktop.yml`'s
  `build-web` step deploys the new web bundle to app.thinkwork.ai, which (1)
  closes the transient `pinArtifact`-not-found break and (2) unblocks S1/S2/S4
  UI flows. A re-dispatched Verification heartbeat (or this worker) then runs
  the four browser flows and greens the matrix. Backend is already verified.
  Trade-off: requires a release action (outward-facing; I did not take it
  unilaterally — a judge, not a mechanic).
- **Option B — wait for the next naturally-cut canary.** Lower effort, but
  leaves the dev break open until the next canary and stalls THINK-178 in
  Verification indefinitely from the factory's perspective.
- **Option C — accept backend + code verification as sufficient, mark Done.**
  Fastest close, but violates the plan's Definition of Done ("all four
  post-deploy browser flows pass on deployed dev with evidence") and ships a
  documented UI-unverified gap.

Secondary (regardless of A/B/C): the plan's **KTD3, Rollout Notes, and
Verification Contract are factually wrong** — they assert "the merge pipeline
deploys Lambda and web assets in the same run" and frame the mismatch as a
"transient stale-bundle window … self-heals on refresh." In this repo web
deploys on `desktop-v*` tags, not merge-to-main, so the skew persists until a
desktop release and reload does nothing. Future plans that rename/remove a
web-consumed mutation should either keep a deprecation alias until the next
desktop release, or cut a canary as part of rollout. Worth a follow-up issue
for the planning lane. (Captured to agent memory:
`project_web_deploys_on_desktop_tag_not_main`.)

@eric1 — which option? (I recommend A.)
