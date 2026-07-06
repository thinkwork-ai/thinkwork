---
date: 2026-07-05
linear_issue: THINK-178
scope: "PR #3399 (U1 — rename Living Canvas version-capture Pin → Snapshot)"
verdict: PASS — rename verified live end-to-end on deployed dev (backend + all four browser flows)
---

# THINK-178 Dogfood Verification — rename artifact "Pin" → "Snapshot"

**Verdict: PASS.** The Living Canvas version-capture rename (Pin → Snapshot) is
**deployed and verified working end-to-end on dev**, both the GraphQL backend
and the web UI. The first pass (2026-07-05, PR #3404) proved the backend half
(S0a/S0b) but was blocked on the four browser flows because `apps/web`
(app.thinkwork.ai) ships only on `desktop-v*` canary tags, not merge-to-main.
Eric cut `desktop-v0.1.0-canary.320` (GH Actions run 28759096737, "Build and
deploy web app" green) to unblock — the renamed Snapshot web bundle is now live
(`releaseVersion: v0.1.0-canary.320`, `curl -sI /` → `last-modified: Sun, 05
Jul 2026 23:56:45 GMT`). This pass ran the previously-blocked UI flows
(S1/S2/S3/S4/S5) in a real browser (agent-browser/Chrome) against deployed dev
and they all pass. The full scenario matrix (S0a, S0b, S1–S5) is green.

**Target:** deployed dev (`app.thinkwork.ai` + GraphQL API
`ho7oyksms0.execute-api.us-east-1.amazonaws.com`), operator session (Eric,
Cognito Google-federated, `Google_113647173195884038979`). Browser session
authenticated by minting fresh Cognito tokens from the CLI dev session's refresh
token (`oauth2/token` refresh_token grant, web client `3k1480d09t676v9miledd1di7m`)
and injecting them into the app's `CognitoIdentityServiceProvider.*` localStorage
keys — interactive WorkOS/Google OAuth is not automatable here.

**Change under test:** PR #3399 (merged 2026-07-05T21:33:27Z, squash commit
`ca2da2bb2f11dddf93c6c7bf7d7222d1f58da3b1`). Renames the Living Canvas
version-capture concept from "Pin" to "Snapshot" across GraphQL API
(`pinArtifact` → `snapshotArtifact`, `pinHeadToVersion` →
`snapshotHeadToVersion`), web UI (canvas header button lucide `Pin` → Tabler
`IconCameraSpark`, title/aria "Snapshot", testid `canvas-pin` →
`canvas-snapshot`, toasts, "No snapshots yet…" empty state), version-chain
comments, and CONCEPTS.md. No behavior change; codegen regenerated in
web/mobile/cli. R8 keep-list untouched; document-domain pin vocab deferred.

## Deploy reality (now resolved)

| Half | Deploys via | State on dev |
|---|---|---|
| GraphQL Lambda (`graphql-http`) — schema + resolvers | merge-to-main Deploy (`deploy.yml` → Terraform Apply) | **LIVE** — `snapshotArtifact` present, `pinArtifact` removed |
| Web app (`apps/web` → app.thinkwork.ai) | **`desktop-v*` tag only** (`release-desktop.yml` `build-web`) | **LIVE** — canary.320 shipped the renamed bundle (`last-modified: 2026-07-05T23:56:45Z`, after the merge) |

Deployed web bundle (canary.320) evidence — the canvas code lives in the shared
`assets/mermaid-GHXKKRXX-B0vGJZlN.js` chunk (hash rolled from canary.319's
`…-DWw-iDqp.js`); `curl` + grep of the live file:

- `snapshotArtifact` ×3, `canvas-snapshot` ×1, `Snapshot saved` ×1,
  `IconCameraSpark`/`camera-spark` ×2, and the **exact** empty-state phrase
  `No snapshots yet. A snapshot captures the current canvas as a read-only
  version.` ×1.
- `pinArtifact` ×0, `canvas-pin` ×0, `No pinned versions` ×0, `Pinning a
  version` ×0, `Pin version` ×0 — every pre-rename string is gone.
- The single `pinned version` substring in the chunk is an **unrelated**
  feature ("Installed agent copies keep running their pinned version until an
  operator applies an update" — agent library version pinning, an R8 keep-list
  "pin" sense), not the canvas concept.

## Scenario matrix

| # | Scenario | Source | Expected | Functional | Experiential |
|---|----------|--------|----------|------------|--------------|
| S0a | Backend: `snapshotArtifact` appends a version | AE1 backend / R5 | Live mutation appends content-addressed version, bumps headVersion | **PASS** (prior pass 0→1; re-proven live this pass via S2's UI-driven 1→2) | n/a |
| S0b | Backend: `pinArtifact` removed (no alias) | AE3 / R5 / KTD3 | Old field 404s on deployed API | **PASS** (GRAPHQL_VALIDATION_FAILED, prior pass) | n/a |
| S1 | Snapshot empty-state copy | QA #2 / VC #2 / R2,R3 | "No snapshots yet. A snapshot captures the current canvas as a read-only version." — no "pinned versions" | **PASS** — exact phrase live in bundle; old copy fully absent; version-history section renders the renamed copy live on two canvases | Clean, no pin vocabulary anywhere |
| S2 | Snapshot capture (button icon + tooltip + toast + history + read-only view) | QA #1 / VC #1 / AE1 → R1,R2 | Camera-spark button "Snapshot"; toast "Snapshot saved (v N)"; history row; View read-only | **PASS** — full flow driven live (see Evidence) | Muted camera-spark icon reads as "snapshot", not "pin" |
| S3 | Favorite / thread pin untouched | QA #3 / VC #3 / AE2 → R8 | Favorite/thread pin + sidebar "Pinned" unchanged, distinct from Snapshot | **PASS** — thread pin (Tabler `pin`, "Pin thread"/"Unpin thread") toggles the sidebar "Pinned" section live; distinct control from camera-spark Snapshot | Two clearly separate affordances |
| S4 | Check-in auto-snapshot | QA #4 / VC #4 / R6 | Re-save/re-emit appends a version | **PASS** — agent edit re-emitted the canvas → Version 2 auto-appended (see Evidence) | headVersion 1→2; only vocabulary changed |
| S5 | Console/network health | Ceiling — regression sweep | No console/GraphQL errors; no stale `pinArtifact` | **PASS** — 0 console errors, 0 failed GraphQL, 0 `pinArtifact` calls across S1–S4 | Only a benign pre-existing Radix `DialogContent` aria warning |

All seven green.

## Evidence

Authenticated as Eric on deployed dev. Living-canvas artifacts on this tenant:
"Largest US States" (`70b3760f…`, thread `a6b4484c…`) and a fresh test canvas
"Fruit Colors" (`Fruit Colors`, created this pass) — the two existing canvases
were both at headVersion ≥ 1, so a purpose-built fresh canvas was generated for
the empty-state/append checks.

**Primary UI surface.** The version-capture Snapshot button renders in the
**in-thread docked canvas panel** (`ThreadArtifactPanel`, THINK-168 U4) —
open a thread → click the canvas `ArtifactCard` → the panel opens beside the
transcript with `CanvasHeaderActions` (Snapshot/Refresh) as muted header icons.
(See "Non-blocking observation" below re: the full-page `/artifacts/$id` header.)

- **S2 — Snapshot capture (live):** opened "Largest US States" in the docked
  panel. Header button asserted from the DOM: `aria-label="Snapshot"`,
  `title="Snapshot"`, `data-testid="canvas-snapshot"`, SVG class
  `tabler-icon tabler-icon-camera-spark` — **no** lucide `pin` in the panel.
  Clicked it → sonner toast **"Snapshot saved (v 2)"** → a new
  `canvas-version-row` **"Version 2 (current) · just now · 0109b65ddab7"**
  appended above "Version 1" → clicked **View** → read-only dialog titled
  **"Version 2 (read-only)"** rendered the table. All GraphQL POSTs 200, no
  console errors. (Screenshots: header camera-spark button, "Snapshot saved
  (v 2)" toast + two-row history, "Version 2 (read-only)" viewer.)

- **S1 — Empty-state copy:** no 0-version canvas exists on dev (born-as-artifact
  canvases start at Version 1), so the empty-state branch was verified by (a)
  the deployed bundle containing the **exact** renamed phrase and **zero**
  occurrences of every old "pinned versions"/"Pin version" string (see Deploy
  reality), and (b) the live version-history section rendering the renamed
  "Version history" heading with **no** "pinned versions" wording on both
  "Largest US States" and the fresh "Fruit Colors" canvas. The empty-state
  string is a single `versions.length === 0` branch of the same component whose
  populated branch was confirmed live.

- **S3 — Favorite / thread pin untouched:** the sidebar thread-pin buttons use
  the Tabler `pin` icon with `title`/`aria` "Pin thread"; clicking one made a
  sidebar **"Pinned"** section appear (live), and the toggle relabels to
  "Unpin thread" (unpinned afterward to restore state). This pin affordance is
  visually and semantically distinct from the camera-spark "Snapshot" control —
  the rename freed the word "pin" for the nav-pin concept without disturbing it.

- **S4 — Check-in auto-snapshot (live):** with "Fruit Colors" (Version 1) open
  in the docked panel, asked the agent (Kimi K2.5) to "Add a fourth row … Grape,
  Purple. Update the same canvas artifact." The agent re-emitted the canvas
  (same stable part id) → the Grape/Purple row appeared in the panel and a new
  **"Version 2 (current)"** row was **auto-appended** to Version history
  (headVersion 1→2), card now "Final · v2". This is the R6 behavior guard:
  a check-in re-emit appends a version — behavior unchanged, only vocabulary.

- **S5 — Console/network health:** across S1–S4, `agent-browser errors` returned
  nothing; the only `console` entry was a benign, pre-existing Radix warning
  ("Missing `Description` or `aria-describedby` for `DialogContent`"). No
  GraphQL request returned 4xx/5xx, and **no** request referenced `pinArtifact`.

_Dev-data note (all non-destructive, append-only):_ "Largest US States"
advanced headVersion 1→2 (S2); a test thread + canvas "Fruit Colors" was created
and advanced to v2 (S1/S4). No deletions or destructive edits.

## Paper cuts

- None in the code under test.

## Non-blocking observation (out of THINK-178 scope)

On the **full-page** artifact route `/artifacts/$id`, the page-header action slot
renders **empty** — the canvas Snapshot button, the document Download button,
the favorite pin toggle, and the artifact overflow menu are all absent. This
reproduces on both the canvas (DATA_VIEW) and document routes, so it is a shared
page-header composition issue, **not** caused by the Pin→Snapshot rename.
Likely root cause (code-level hypothesis): in `routes/_authed/_shell/
artifacts.$id.tsx`, the parent `AppletRouteContent` calls `usePageHeaderActions`
with a **null** `action` (its `artifactId` comes from the paused Applet query for
non-APPLET types), and that effect runs after the child
`DataViewArtifactContent`/`DocumentArtifactContent` effect — clobbering the
child's composed header actions to empty. The version-capture Snapshot button is
fully reachable and functional via the in-thread docked canvas panel
(`ThreadArtifactPanel`), where this pass verified it. Recommend a **separate**
Linear issue for the full-page header regression; it does not block THINK-178.

## Decisions for a human

None — the rename is complete, deployed, and verified end-to-end. Matrix is
green (S0a, S0b, S1–S5). (The full-page header observation above is a distinct,
non-blocking follow-up, not a THINK-178 decision.)
