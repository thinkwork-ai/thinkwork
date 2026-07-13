# Dogfood Verification — THINK-274: Web wiki reader renders the HTML plate (THINK-270 U3)

- **Date:** 2026-07-13
- **Verifier:** Claude verification worker (auto/think-274-verify-a1)
- **Issue:** [THINK-274](https://linear.app/thinkworkai/issue/THINK-274) — labels `Claude`, `LFG`; status `Verification`
- **Implementation PR:** [#3672](https://github.com/thinkwork-ai/thinkwork/pull/3672) — merge commit `2ba6d70e7`, merged 2026-07-13T13:40:51Z, all checks green
- **Target:** deployed dev web app `https://app.thinkwork.ai` (dev GraphQL `ho7oyksms0…/graphql`), dogfood tenant `sleek-squirrel-230`
- **Verdict:** ⛔ **BLOCKED — not deployed.** The merged web change is correct in code but is **not live** on `app.thinkwork.ai`; browser flows are unverifiable until a canary web release is cut. No product-code defect found. Requires a human release action (see _Decisions for a human_).

---

## Executive summary

The THINK-274 implementation (PR #3672) is merged to `main` and the post-merge
Deploy run on main (`29254716982`) is green. **However, the web app served at
`app.thinkwork.ai` does not update on merge-to-main** — by design, `apps/web`
ships only when a `desktop-v*` / `v*` **canary tag** is cut (`deploy.yml` NOTE;
`release-desktop.yml build-web`). Nothing auto-mints those tags.

The live bundle at `app.thinkwork.ai` was built by **canary.351** at
**2026-07-13T02:03:26Z**, ~11.5 h _before_ THINK-274 merged (13:40:51Z). No
canary has been cut since the merge (latest tag family = 351). The deployed
JavaScript therefore **does not contain the THINK-274 change**, empirically
confirmed three independent ways (see Evidence). Driving the six browser flows
against this bundle would verify the _old_ UI, not the change under test — a
vacuous pass. Verification is therefore correctly halted here.

This is a known, documented, recurring dogfood trap (bit THINK-178 and THINK-180
previously): a verification contract that says "browser flows on deployed dev
after the main deploy" is **unsatisfiable for a web-only UI change** until a
desktop canary ships. See `docs/solutions/workflow-issues/canary-release-tagging-web-desktop-2026-06-11.md`.

The ledger claim "Web build with this change is live on dev" (attempt-3 record)
was inferred from the _main_ Deploy run's success and is inaccurate for the web
front — exactly the failure mode that memory documents. The implementation is
sound; only the deploy has not landed.

---

## Preconditions

| Precondition                                              | State | Evidence                                                                                                                                 |
| --------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| All implementation PRs merged                             | ✅    | PR #3672 `state=MERGED`, merge `2ba6d70e7`, 13:40:51Z                                                                                    |
| Post-merge Deploy on main green                           | ✅    | run `29254716982` `conclusion=success`                                                                                                   |
| GraphQL `WikiPage.renderHtml` live on dev API             | ✅    | direct query returns 6882-char render for `entity/chef-nicolas-rondelli`, `lastCompiledAt 13:59:11Z`; dev backfill (1,683 pages) done    |
| **Web bundle with the change live on `app.thinkwork.ai`** | ❌    | live bundle `last-modified 2026-07-13T02:03:26Z` (canary.351), predates merge; deployed `ComputerWikiPage` query has **no `renderHtml`** |

Because the last precondition is false, the change is **not exercisable in a
real browser** and scenario execution is deferred.

---

## Evidence (deployment gap)

1. **Live bundle age precedes the merge.**
   `curl -sI https://app.thinkwork.ai/assets/index-CRdeOga2.js` →
   `last-modified: Mon, 13 Jul 2026 02:03:18 GMT`. Index HTML `last-modified: 02:03:26Z`.
   Merge was `13:40:51Z`. Gap ≈ 11.5 h.

2. **No canary cut since the merge.**
   Latest release/tag family is **canary.351** (`v0.1.0-canary.351` /
   `desktop-v0.1.0-canary.351`, released `2026-07-13T02:03:36Z`). No 352 exists.
   `app.thinkwork.ai` last-modified matches canary.351's build time exactly.

3. **Deployed JS lacks the change (three markers).** Fetched the live wiki
   chunk (`assets/mermaid-GHXKKRXX-Bf_x2Ucn.js`, the chunk carrying `WikiPage`
   code) and the entry bundle:
   - Deployed `ComputerWikiPage` GraphQL query field set is
     `id type slug title summary bodyMd status lastCompiledAt updatedAt aliases sections{…}` —
     **no `renderHtml`** (PR #3672 added it). See `evidence-THINK-274/02-deployed-query.txt`.
   - `top-by-user-activation` (the `DocumentFrame navigation` prop value): **0 occurrences**.
   - `100vh-14rem` (the wiki plate reading-pane class `h-[calc(100vh-14rem)]`): **0 occurrences**.
   - `<base target="_top">` injection: **0 occurrences**.

4. **Browser confirms fallback, not plate.** Navigating to
   `/wiki/entity/chef-nicolas-rondelli` (a page whose API render is 6882 chars,
   i.e. the plate _should_ show) renders the **section list** (`Overview`,
   `Relationships`) with **no `[data-testid="document-frame"]`** in the DOM —
   the pre-THINK-274 UI. Screenshot: `evidence-THINK-274/01-wiki-page-section-fallback.png`.
   This is the old code path, not the R4 fallback branch of the new code.

---

## Scenario matrix

Seeded from the handoff QA checklist (flows 1–6) + the plan's U3 verification
contract. All are **deferred pending a canary web deploy**; none can be driven
against the live bundle without producing a vacuous result.

| #   | Scenario (Req)                                                                                                                                                                         | Functional | Experiential | Status                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ | ---------------------- |
| 1   | Search palette → framed HTML plate + light/dark theme + tenant palette (R1/R5/AE4)                                                                                                     | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |
| 2   | In-wiki `/wiki/<type>/<slug>` anchor click navigates SPA route via full reload (AE1/R2)                                                                                                | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |
| 3   | External `http(s)` URL in render is inert text, not a link (AE2/R3) — seed if absent                                                                                                   | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |
| 4   | NULL/empty render → section fallback, no error/blank frame (AE3/R4)                                                                                                                    | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |
| 5   | Dossier-card entry → same reader, same plate behavior (R6)                                                                                                                             | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |
| 6   | Artifact reader regression: `sandbox=""` byte-identical, no `<base>`; wiki iframe sandbox exactly `allow-top-navigation-by-user-activation` + `<base target="_top">` (R6, containment) | ⏸ deferred | ⏸ deferred   | Blocked — not deployed |

### Static (code) corroboration — not a substitute for browser proof

Reading the merged diff (`2ba6d70e7`) shows the implementation matches the
contract: `renderHtml` added to `ComputerWikiPageQuery` + `WikiPageDetail`;
`DocumentFrame` opt-in `navigation?: "none" | "top-by-user-activation"` with the
sandbox/`<base target="_top">` pairing; artifact call sites keep `sandbox=""`
byte-identical (locked by the kept literal assertion + envelope regression
test); `WikiPageView` plate branch replaces only the sections region with a
falsy guard treating empty-string as NULL (R4). CI green: full web suite
256 files / 2097 tests. This raises confidence that the deferred flows will pass
once deployed, **but is explicitly not a pass** — the verification contract
requires real-browser proof of freshly-generated output.

---

## Paper cuts

None observed (nothing new was exercisable).

---

## Decisions for a human

1. **Cut a web canary release so THINK-274 (and any other web changes merged
   since canary.351) go live on `app.thinkwork.ai`, then re-dispatch this
   verification phase.**
   - Why a human: cutting a release tag triggers `release.yml` + `release-desktop.yml`
     — an outward-facing release event (deploys the ThinkWork web front for all
     users and publishes desktop artifacts). Per release doctrine, canary tags
     are minted manually (`nothing auto-mints canary tags`); no automation will
     resolve this on its own, so `waiting-on-deploy` alone would loop with no
     human ever notified.
   - **Recommended action:** tag both `v0.1.0-canary.352` and
     `desktop-v0.1.0-canary.352` at `origin/main` (commit `2ba6d70e7` or later),
     push, watch `release.yml` + `release-desktop.yml` to green, then confirm
     `app.thinkwork.ai` `last-modified` advances and the deployed
     `ComputerWikiPage` query contains `renderHtml`. Recipe:
     `docs/solutions/workflow-issues/canary-release-tagging-web-desktop-2026-06-11.md`.
   - After the canary lands, re-run this verification worker to drive flows 1–6
     with freshly-generated renders and record pixel evidence.

No code repair is requested — the implementation is not the blocker.
