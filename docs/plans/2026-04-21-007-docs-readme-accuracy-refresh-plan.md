---
title: "docs: README accuracy refresh"
type: docs
status: active
date: 2026-04-21
---

# docs: README accuracy refresh

## Overview

The root `README.md` has drifted in several load-bearing places: Evaluations is listed as "Planned" but has shipped (admin UI lives under `apps/admin/src/routes/_authed/_tenant/evaluations/`), the Mobile app section links to a non-shipped screenshot (`tasks-list.png` lives under `apps/www/assets/reserve/`, not in `public/images/`), and the mobile narrative still leans on a retired LastMile task connector. The README is also silent on the shipped Compounding Memory / Wiki surface that now anchors the mobile story.

This plan refreshes the README so that a developer landing on the repo today sees an accurate, helpful picture: what's shipped, what's still ahead, and a quick start that actually matches the CLI that's published to npm.

## Problem Frame

New contributors and evaluating devs start at the root `README.md`. When it overstates what's planned (Eval UI), links to broken assets (`tasks-list.png`), references retired features (LastMile task connector), or diverges from canonical docs on positioning (Knowledge Graph vs. Compounding Memory Wiki), it:

- Erodes trust — readers assume other claims are also stale.
- Hides shipped work — Evaluations is a headline v1 capability buried as "Planned".
- Sends confused onboarding signals — Mobile is pitched as an external-task inbox when the actual shipped anchor on mobile is the Wiki (Compounding Memory pages).

The scope is deliberately narrow: accuracy + minor helpfulness improvements in the existing `README.md`. Not a rewrite, not new doc pages.

## Requirements Trace

- R1. **Evaluations reflected as shipped** — Move "Eval UI" out of the Roadmap table; surface it in the "What ships in v1" module list.
- R2. **Mobile Wiki screenshot present** — Replace the broken `tasks-list.png` reference with the shipped `apps/www/public/images/mobile/wiki-graph.png` and update surrounding copy.
- R3. **README consistent with canonical docs** — Reconcile Knowledge Graph / Ontology Studio wording with `docs/src/content/docs/roadmap.mdx` (which frames KG as forward direction, not shipped).
- R4. **Retire stale references** — Remove/rewrite language pointing to the LastMile task connector (retired 2026-04-20) and to "Agentic Tasks" / "Question Cards" terminology that no longer appears in any concept doc.
- R5. **Quick Start matches the published CLI** — Align the six-step flow with `apps/cli/README.md` so a dev copy-pasting actually gets to a working stack, including `thinkwork plan` and `thinkwork bootstrap`.
- R6. **Status line truthful** — The "Pre-release. v0.1.0 is in active development" line conflicts with `apps/cli/package.json` (0.9.0). Reconcile to a status line that doesn't require re-editing on every bump.

## Scope Boundaries

- Not rewriting the README structure, voice, or positioning.
- Not authoring new docs under `docs/src/content/docs/`.
- Not touching `apps/cli/README.md`, `CONTRIBUTING.md`, `SECURITY.md`, or the docs site.
- Not capturing new screenshots. All image swaps use assets already shipped under `apps/www/public/images/`.

### Deferred to Separate Tasks

- Capturing `evals-run.png` for the docs site evals showcase: tracked in `apps/www/public/images/admin/CAPTURE.md` under "Not yet captured".
- Renaming "Knowledge Graph view" everywhere in product copy (admin sidebar, docs): out of scope for this README pass.

## Context & Research

### Relevant Code and Patterns

- `README.md` (lines 1–111) — the file this plan edits.
- `apps/cli/README.md` — source of truth for the CLI Quick Start sequence and command descriptions.
- `apps/cli/src/cli.ts` — confirms which API-side commands are real (`eval`, `wiki`, `me`, `mcp`, `tools`, `user`) vs. scaffolded stubs (`thread`, `agent`, `template`, `tenant`, `member`, `team`, `kb`, `routine`, `scheduled-job`, `turn`, `wakeup`, `webhook`, `connector`, `skill`, `memory`, `recipe`, `artifact`, `cost`, `budget`, `performance`, `trace`, `inbox`, `dashboard`). Current README's "scaffolded roadmap of …" list is still accurate.
- `apps/cli/src/commands/eval.ts`, `apps/cli/src/commands/wiki.ts` — confirm `eval` and `wiki` are real, not stubs.
- `apps/admin/src/routes/_authed/_tenant/evaluations/` — shipped routes: `index.tsx`, `$runId.tsx`, `studio/index.tsx`, `studio/new.tsx`, `studio/edit.$testCaseId.tsx`, `studio/$testCaseId.tsx`.
- `apps/mobile/app/wiki/` and `apps/admin/src/routes/_authed/_tenant/wiki/` — confirm Wiki (Compounding Memory) is shipped on both surfaces.
- `apps/www/public/images/admin/CAPTURE.md` — authoritative inventory of shipped vs. reserve screenshots. Confirms:
  - `apps/www/public/images/mobile/wiki-graph.png` is shipped and is the intended "Mobile Wiki" screenshot.
  - `apps/www/public/images/mobile/tasks-list.png` is in reserve (NOT shipped) — the current README link is broken.
- `docs/src/content/docs/roadmap.mdx` — canonical position: Evaluations is Beta/shipped; Knowledge Graph + Ontology Studio is forward-looking, not in v1.
- `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx` — canonical framing of the Wiki as "Compounding Memory" pages.

### Institutional Learnings

- Memory note `project_evals_scoring_stack.md` — evals v1 uses AWS Bedrock AgentCore Evaluations (Strands-native built-ins). README shouldn't invent a different scoring stack.
- Memory note `project_lastmile_two_surfaces.md` — LastMile-as-task-connector is retired (2026-04-20); LastMile-as-MCP-server stays. The README mentions the retired surface twice.

### External References

- None required. All source-of-truth material is in-repo.

## Key Technical Decisions

- **Keep README structure** — Sections stay: Status, What ships in v1, Admin web, Mobile app, Roadmap, Quick start, Repo layout, Technology, Contributing, Security, License. Only content inside each section changes.
- **Prefer "shipped" evidence over prose claims** — Where a feature has a screenshot in `apps/www/public/images/` and a route/command in the repo, reference it by image and link. Where a feature is forward-looking, defer to `docs/src/content/docs/roadmap.mdx` phrasing so the README and docs stay aligned.
- **Mobile anchor = Wiki, not tasks** — The shipped mobile hero flow is threads + wiki; external task intake has retired. Replace the second mobile screenshot with `wiki-graph.png` and rewrite the surrounding paragraph.
- **Knowledge Graph phrasing** — Drop "Knowledge Graph view" from the Memory bullet and drop "shipped Knowledge Graph" from the Ontology Studio roadmap row. Use "memory graph view" (lowercase, descriptive) for the admin capability that's actually shipped, matching the `memories-graph.png` screenshot filename and admin docs.
- **CLI version line** — Replace hard-coded "v0.1.0" status sentence with a status line that points at the npm badge + CHANGELOG rather than pinning a version number (no more drift on every bump).
- **Quick Start alignment** — Mirror `apps/cli/README.md`'s canonical deploy sequence: `login → doctor → init → plan → deploy → bootstrap → outputs` on the deploy side, then `login --stage → me` on the API side. Keep the "X commands, one AWS account" framing but make the number match what's actually listed.

## Open Questions

### Resolved During Planning

- **Which mobile screenshot replaces `tasks-list.png`?** → `apps/www/public/images/mobile/wiki-graph.png`. Confirmed shipped per `CAPTURE.md`.
- **Is Evaluations in v1 or forward-looking?** → In v1 (Beta) per `docs/src/content/docs/roadmap.mdx`. Admin routes + `eval` CLI command confirm.
- **Should we keep the "Six product modules" framing?** → Yes. Adjust the list so it matches shipped surfaces but don't restructure the section.

### Deferred to Implementation

- Exact wording for the reworded Mobile paragraph and Memory bullet — finalize during the edit, keeping the existing sentence shape where possible.
- Whether to add one more admin screenshot (e.g., `cost-analytics.png` or `agent-templates.png`) inline. Decide during edit based on how the page reads end-to-end; guardrail is "helpful for devs, not marketing bloat".

## Implementation Units

- [ ] **Unit 1: Fix Mobile app section — swap in shipped Wiki screenshot, rewrite copy around Compounding Memory**

  **Goal:** Replace the broken `tasks-list.png` reference with the shipped Wiki screenshot and rewrite the paragraph so it describes what actually ships on mobile today (threads + compounding memory wiki), not the retired LastMile task intake.

  **Requirements:** R2, R4

  **Dependencies:** None.

  **Files:**
  - Modify: `README.md` (Mobile app section — lines ~49–55)

  **Approach:**
  - Update the second `<img>` tag: change `src` to `./apps/www/public/images/mobile/wiki-graph.png`; change `alt` to a Wiki-appropriate description (e.g., "Wiki tab — Compounding Memory pages rendered as a knowledge graph in the ThinkWork mobile app").
  - Rewrite the paragraph to:
    - Keep "Expo + React Native client at `apps/mobile`, currently shipping on iOS via TestFlight".
    - Drop "tasks routed in from systems like LastMile — tasks render as native GenUI cards".
    - Replace with a sentence describing the Wiki experience (Compounding Memory pages about people, places, decisions — browseable on device), grounded in `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx`.
    - Keep "mobile app owns per-user OAuth and MCP tokens; tenant configuration stays on the admin side".
  - Keep the trailing docs link (`https://docs.thinkwork.ai/applications/mobile/`).

  **Patterns to follow:** Match the Admin web section's rhythm (one-sentence "this is what it is" + one-sentence "this is what operators do here" + doc link).

  **Test scenarios:**
  - Happy path — Opening the README in a markdown renderer shows both mobile images with valid `src` paths that exist on disk.
  - Edge case — Running `ls apps/www/public/images/mobile/wiki-graph.png` resolves; `ls apps/www/public/images/mobile/tasks-list.png` is no longer referenced.
  - Integration — GitHub README rendering shows the image (verify by opening the file on GitHub or a local markdown preview).

  **Verification:**
  - Both mobile `<img>` `src` paths point at files that exist under `apps/www/public/images/mobile/`.
  - The paragraph no longer mentions LastMile or GenUI task cards.
  - The paragraph mentions the Wiki / Compounding Memory surface explicitly.

- [ ] **Unit 2: Promote Evaluations out of Roadmap, into "What ships in v1"**

  **Goal:** Reflect that Evaluations has shipped by removing it from the Roadmap table and adding it to the shipped-modules list, consistent with `docs/src/content/docs/roadmap.mdx` (which lists Evaluations as Beta/shipped).

  **Requirements:** R1

  **Dependencies:** None.

  **Files:**
  - Modify: `README.md` ("What ships in v1" section — lines ~28–38; Roadmap section — lines ~57–67)

  **Approach:**
  - In the "What ships in v1" bullet list, add an Evaluations bullet. Suggested shape: "**Evaluations:** in-app test-case authoring, eval runs, and per-agent scoring (Bedrock AgentCore Evaluations under the hood)". Place it near the Memory / Cost bullets so it sits with other observability-adjacent items.
  - In the Roadmap table, delete the "Eval UI" row.
  - If the `Ontology Studio` row survives Unit 3, keep it; otherwise allow Unit 3 to adjust it.

  **Patterns to follow:** Match the existing bullet style (bold lead-in + one sentence). Don't overclaim — say what a user can do in the UI, not marketing copy.

  **Test scenarios:**
  - Happy path — "Evaluations" appears in the "What ships in v1" list and does NOT appear in the Roadmap table.
  - Edge case — A developer reading the README followed by `docs/src/content/docs/roadmap.mdx` sees consistent framing (Evaluations = Beta/shipped, not planned).

  **Verification:**
  - `grep -n "Eval UI" README.md` returns no matches.
  - The "What ships in v1" bullets include an Evaluations entry.

- [ ] **Unit 3: Reconcile Knowledge Graph / Ontology Studio language with canonical docs**

  **Goal:** Eliminate the internal contradiction between the README ("Knowledge Graph view" shipped; "Ontology Studio — Authoring UI on top of the shipped Knowledge Graph") and the canonical position in `docs/src/content/docs/roadmap.mdx` (Knowledge Graph + Ontology Studio is forward direction, not v1).

  **Requirements:** R3

  **Dependencies:** None.

  **Files:**
  - Modify: `README.md` (Memory bullet in "What ships in v1" — line ~35; Ontology Studio row in Roadmap — line ~63)

  **Approach:**
  - In the Memory bullet, replace "including a **Knowledge Graph** view for inspecting per-agent memory relationships" with language that describes what actually ships in the admin: a **memory graph view** (lowercase, descriptive) that visualizes relationships between stored memories across agents. Match the `memories-graph.png` filename to avoid a terminology mismatch with the existing admin dashboard screenshot.
  - In the Roadmap table, rewrite the "Ontology Studio" row's Notes column to drop the phrase "on top of the shipped Knowledge Graph". Reframe as: "Authoring UI for entity/relation schemas — a step beyond today's memory graph view." (Keep the row itself; it's still Planned per canonical docs.)

  **Patterns to follow:** `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx` treats the KG explicitly as "forward direction". Mirror that conservatism.

  **Test scenarios:**
  - Happy path — The Memory bullet describes a shipped capability (memory graph view) without claiming the full Knowledge Graph product.
  - Edge case — Reading the README, then the docs roadmap, produces no contradiction about whether Knowledge Graph is shipped.

  **Verification:**
  - No capitalized "Knowledge Graph" appears in the README outside of forward-looking/roadmap context.
  - The Ontology Studio row no longer asserts that Knowledge Graph has shipped.

- [ ] **Unit 4: Remove stale terminology — LastMile task connector, Agentic Tasks, Question Cards**

  **Goal:** Drop retired feature names that no longer have any backing in `docs/src/content/docs/` or in the admin/mobile UI, so the README doesn't claim surfaces that don't exist.

  **Requirements:** R4

  **Dependencies:** Unit 1 (may already remove one LastMile mention).

  **Files:**
  - Modify: `README.md` ("What ships in v1" — line ~33 "plus a LastMile task connector for external task intake"; line ~34 "Agentic Tasks and Question Cards for structured task intake and execution")

  **Approach:**
  - Remove "(plus a LastMile task connector for external task intake)" from the Three connectors bullet. The connector list remains Slack, GitHub, Google Workspace — matching `docs/src/content/docs/roadmap.mdx`. Do not replace with LastMile-as-MCP-server: that's not a first-class launch connector and would confuse readers.
  - Delete the "Agentic Tasks and Question Cards" bullet. No concept doc uses these names. Threads + channels (as framed in `docs/src/content/docs/roadmap.mdx`) already covers the intended idea; if a replacement sentence is warranted, use "Threads with structured channels (CHAT, AUTO, EMAIL, SLACK, GITHUB) for task intake and execution" so it matches canonical docs.

  **Patterns to follow:** `docs/src/content/docs/roadmap.mdx` "What's in v1" table — single source of truth for what's shipped.

  **Test scenarios:**
  - Happy path — `grep -i lastmile README.md` returns no matches. `grep -i "question card" README.md` returns no matches. `grep -i "agentic task" README.md` returns no matches.
  - Edge case — Removing the LastMile mention does not dangle a trailing "(plus …)" fragment in the bullet.

  **Verification:**
  - No retired terminology survives in the README.
  - The connector list matches canonical docs.

- [ ] **Unit 5: Tighten Quick Start and Status line**

  **Goal:** Align the Quick Start with `apps/cli/README.md` so a developer who copy-pastes ends up at a working stack, and reconcile the Status line so it doesn't immediately contradict `apps/cli/package.json` (currently 0.9.0).

  **Requirements:** R5, R6

  **Dependencies:** None.

  **Files:**
  - Modify: `README.md` (Status section — line ~26; Quick start section — lines ~69–81)

  **Approach:**
  - Replace the Quick Start block with the canonical deploy + sign-in sequence from `apps/cli/README.md`:
    - `thinkwork login` (pick AWS profile)
    - `thinkwork doctor -s dev`
    - `thinkwork init -s dev`
    - `thinkwork plan -s dev`
    - `thinkwork deploy -s dev`
    - `thinkwork bootstrap -s dev`
    - `thinkwork login --stage dev`
    - `thinkwork me`
  - Update the trailing sentence so the command count matches (e.g., "Eight commands, one AWS account, …" — or drop the numeric claim and keep the narrative). Preferred: keep a numeric anchor because it's load-bearing to the marketing voice, just make it accurate.
  - In the Status section, replace "🚧 **Pre-release.** v0.1.0 is in active development. Watch this repo for the release." with a version-agnostic line that references the npm package + roadmap without pinning a number (e.g., "🚧 **Pre-release.** See the [thinkwork-cli npm releases](https://www.npmjs.com/package/thinkwork-cli) for the current version and the [roadmap](https://docs.thinkwork.ai/roadmap/) for what's landed vs. planned.").

  **Patterns to follow:** `apps/cli/README.md` Quick Start section (the canonical command sequence).

  **Test scenarios:**
  - Happy path — Each command in the README's Quick Start exists in `apps/cli/src/cli.ts` (grep for `registerXxxCommand` import). `login`, `doctor`, `init`, `plan`, `deploy`, `bootstrap`, `me` all present.
  - Edge case — The "X commands" phrase in the trailing sentence matches the actual command count above it.
  - Integration — Status line no longer names a specific version number.

  **Verification:**
  - Running `grep -n "v0.1.0" README.md` returns no matches.
  - Every command listed in Quick Start is a real registered CLI command.
  - The command count in the prose matches the count in the code block.

- [ ] **Unit 6: Cross-read + link sanity pass**

  **Goal:** Catch residual drift introduced by the earlier units — broken images, contradictory copy between "What ships in v1" and the Roadmap table, or links that 404 against the published docs site.

  **Requirements:** R1–R6 (verification pass)

  **Dependencies:** Units 1–5.

  **Files:**
  - Modify: `README.md` (wherever the cross-read surfaces a fix)

  **Approach:**
  - Re-read the full README top-to-bottom.
  - For every `<img src="./...">` confirm the path exists (`apps/www/public/images/admin/dashboard.png`, `apps/www/public/images/mobile/threads-list.png`, `apps/www/public/images/mobile/wiki-graph.png`, `docs/src/assets/logo.png`).
  - For every `https://docs.thinkwork.ai/...` link, confirm the path exists under `docs/src/content/docs/` (Starlight maps filename → URL). Most high-traffic ones (`/getting-started/`, `/applications/admin/`, `/applications/mobile/`) should resolve.
  - Check that the "What ships in v1" list and the Roadmap table don't list the same item.
  - Check that the CLI command surfaces described in prose match `apps/cli/src/cli.ts` registrations. Don't expand or contract the roadmap list of scaffolded commands.

  **Patterns to follow:** Treat `docs/src/content/docs/roadmap.mdx` as the tie-breaker for any framing dispute between the README and the docs site.

  **Test scenarios:**
  - Happy path — All image `src` paths resolve on disk.
  - Edge case — No feature appears in both "What ships in v1" and the Roadmap table.
  - Error path — Any doc link that points at a path not present in `docs/src/content/docs/` is corrected to a canonical path or removed.

  **Verification:**
  - Final `grep -n "tasks-list.png\|Eval UI\|LastMile task\|Question Cards\|Agentic Tasks\|v0.1.0" README.md` returns no matches.
  - Final `ls` of every referenced image path succeeds.

## System-Wide Impact

- **Interaction graph:** README is a leaf document. No callbacks, no runtime dependencies, no consumers beyond humans reading GitHub and mirrors.
- **Error propagation:** None — editing-only.
- **State lifecycle risks:** None.
- **API surface parity:** `apps/cli/README.md` and `docs/src/content/docs/roadmap.mdx` are adjacent sources of truth. If they disagree with each other, defer to the docs site and call out the drift rather than silently picking one.
- **Integration coverage:** Visual rendering on GitHub (primary entry point) and the docs site preview (if it embeds the README). No other consumers.
- **Unchanged invariants:** Section ordering, overall voice, and positioning ("AWS-native, no Kubernetes, no third-party SaaS control plane") are explicitly preserved.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Over-editing — turning accuracy refresh into a full rewrite. | Implementation units are scoped to specific lines and specific claims; Unit 6 is explicitly a sanity pass, not a rewrite pass. |
| New terminology drift — README invents phrasing that diverges from docs. | Every reworded passage is grounded in an existing doc (`roadmap.mdx`, `compounding-memory.mdx`, `apps/cli/README.md`) and quoted or paraphrased close to source. |
| Image link still broken after edit. | Unit 6 explicitly verifies every `src` path against disk. |
| Quick Start no longer matches CLI after a future bump. | Status line moves to a version-agnostic anchor (npm releases + roadmap), so routine version bumps don't invalidate the README. |

## Documentation / Operational Notes

- No rollout. This is a pure doc edit landing via a standard PR to `main`.
- Reviewer should load the README via GitHub preview to confirm image rendering before approving.

## Sources & References

- Canonical roadmap: `docs/src/content/docs/roadmap.mdx`
- Compounding Memory concept: `docs/src/content/docs/concepts/knowledge/compounding-memory.mdx`
- Knowledge Graph direction: `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx`
- CLI Quick Start source of truth: `apps/cli/README.md`
- Shipped screenshot inventory: `apps/www/public/images/admin/CAPTURE.md`
- Evals routes: `apps/admin/src/routes/_authed/_tenant/evaluations/`
- LastMile retirement memory: `project_lastmile_two_surfaces.md`
- Evals stack memory: `project_evals_scoring_stack.md`
