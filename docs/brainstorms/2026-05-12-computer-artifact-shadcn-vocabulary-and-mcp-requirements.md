---
date: 2026-05-12
topic: computer-artifact-shadcn-vocabulary-and-mcp
supersedes: 2026-05-12-computer-html-artifact-substrate-requirements.md
---

# Computer Artifacts — shadcn-only authoring vocabulary + shadcn MCP

## Summary

The Computer agent continues to author artifacts as TSX modules and the existing iframe-shell / sucrase / vendored-deps runtime continues to execute them. The change is at the authoring layer: the constrained-import-surface validator tightens to a small shadcn-only allowlist, and the Computer agent gains a shadcn MCP server so it can browse the component catalog mid-generation. The morning 2026-05-12 plan to delete TSX and introduce an HTML payload kind is reversed.

---

## Problem Frame

The Computer artifact app builder is shipping outputs that are simultaneously ugly, misshapen, unreliable, and slow. The morning 2026-05-12 brainstorm attributed the badness primarily to substrate weight and pushed for a substrate collapse (kill TSX, add an HTML payload kind, three host-rendered specials). Re-examination during this brainstorm reframes the diagnosis:

- The substrate cost is real, but it does not explain "ugly" or "agent picks wrong UI shape." Those are agent-skill and design-vocabulary problems, not substrate problems.
- Killing TSX is the wrong lever. It removes the authoring surface the agent is already trained on (TSX with shadcn + Tailwind + React) and substitutes one (HTML-with-semantic-classes) the agent has to learn from scratch. v0 / Replit / bolt.diy quality comes from a tight shadcn-plus-Tailwind-plus-React vocabulary, not from an HTML-and-CSS authoring surface.
- The leaflet CDN compatibility shim, vendored React/shadcn/recharts/leaflet, iframe-shell, and host-applet RPC are not actively causing bugs today. They are substrate weight, not substrate breakage. Slimming them is hygiene, not a fix for "results are bad."
- The dominant fixable causes of bad output are (a) the agent has no enforced design vocabulary, so it freelances ad-hoc `<div className="card-ish">` styling alongside real shadcn imports, and (b) the agent has no programmatic way to discover shadcn primitives or their prop shapes — it guesses.

The shipped substrate stays. The validator tightens. The agent gets a catalog.

---

## Actors

- A1. End user — opens artifacts in `apps/computer`, reads them, fills forms, refreshes data.
- A2. Computer agent — authors artifacts as TSX modules using shadcn primitives as the only allowed component vocabulary.
- A3. `apps/computer` shell — fetches artifacts, dispatches TSX to the existing iframe-shell runtime, owns artifact chrome.
- A4. save-artifact validator — enforces the shadcn-only import allowlist and styling rules at save time.
- A5. shadcn MCP server — host-side MCP tool surface exposed to the Computer agent for catalog discovery.
- A6. Operator — adds new primitives to the allowlist via host PR when product needs justify them.

---

## Key Flows

- F1. Agent authors a shadcn-only TSX artifact
  - **Trigger:** Agent decides a result is best expressed as an artifact.
  - **Actors:** A2, A5, A4.
  - **Steps:** Agent calls shadcn MCP tools (`list_components`, `get_component_source`, `search_registry`) to discover what primitives are available and how their props are shaped → agent emits TSX importing only from the allowlist → save-artifact validator rejects on any disallowed import, hand-rolled approximation, or unsafe expression → on pass, artifact stored using the existing payload shape.
  - **Outcome:** A TSX artifact whose imports and rendered structure are entirely shadcn-shaped.
  - **Covered by:** R1, R2, R4, R5, R6, R7.

- F2. End user opens a shadcn-shaped artifact
  - **Trigger:** A1 clicks an artifact.
  - **Actors:** A1, A3.
  - **Steps:** Shell fetches artifact → existing iframe-shell runtime compiles the TSX via sucrase → renders inside the iframe with vendored React/shadcn/recharts → artifact chrome unchanged.
  - **Outcome:** Artifact renders identically to today's substrate path; the visual-quality lift comes from the constrained authoring vocabulary, not a different render path.
  - **Covered by:** R10, R11.

- F3. Agent attempts to import or style outside the allowlist
  - **Trigger:** Agent emits `import { Calendar } from "lucide-react"`, raw `from "recharts"` not nested inside a `<ChartContainer>`, or hand-rolls `<div className="bg-white rounded-lg p-4 shadow-sm">` instead of `<Card>`.
  - **Actors:** A2, A4.
  - **Steps:** save-artifact validator detects the disallowed import or pattern → returns a structured error naming the offense and pointing the agent at the allowlist + a suggested shadcn equivalent → agent retries with a compliant approach.
  - **Outcome:** No off-vocabulary artifact ships.
  - **Covered by:** R3, R4, R5, R9.

- F4. Operator expands the allowlist
  - **Trigger:** A real product need surfaces that current shadcn primitives cannot express (e.g., calendar, command palette, new chart shape).
  - **Actors:** A6.
  - **Steps:** Operator opens a host PR adding the new primitive to the allowlist (and, if needed, vendoring the supporting dependency in the iframe runtime) → PR merges → the shadcn MCP catalog reflects the new entry on the next agent run.
  - **Outcome:** Allowlist grows on real evidence, not speculation.
  - **Covered by:** R8.

- F5. End user fills a form, refreshes data, persists state
  - Unchanged from today's iframe-shell substrate. Form-state persistence, Refresh chrome, favorite/share/title chrome all behave identically.
  - **Covered by:** R11.

---

## Requirements

**Authoring vocabulary**

- R1. Agents author artifacts as TSX modules. The artifact payload format and the iframe-shell runtime are unchanged.
- R2. The only component vocabulary agents may use is the shadcn-only allowlist defined in R4. Agents may not introduce arbitrary third-party UI libraries.
- R3. Agents may not hand-roll Tailwind-styled HTML approximations of shadcn primitives — e.g., `<div className="bg-white rounded-lg p-4 shadow-sm">` is rejected when `<Card>` would cover it. Tailwind utility classes remain allowed for layout-level adjustments on shadcn components (`<Card className="mt-4">` is fine).

**Validator allowlist**

- R4. The save-artifact validator's import allowlist is:
  - All shadcn/ui primitives exported by the registry
  - React core hooks (`useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`)
  - recharts primitives (`LineChart`, `BarChart`, `Area`, `XAxis`, etc.) **only when nested inside a shadcn `<ChartContainer>`**
  - One host-special component `HostMap` for geographic display
- R5. The validator rejects, with a structured error, any import outside R4's allowlist, any `<script>` tag, any `dangerouslySetInnerHTML`, any inline `on*` HTML handlers in non-shadcn elements, and any top-level network call not routed through host-provided hooks.
- R8. The allowlist is host code, not runtime config. Adding to it is a host PR.
- R9. Validator errors are structured (component name, line, suggested shadcn equivalent where applicable) so the agent can recover in one short retry without reprompting from scratch.

**shadcn MCP integration**

- R6. A shadcn MCP server is exposed to the Computer agent at runtime. It provides at minimum: `list_components`, `get_component_source`, `get_block`, `search_registry`.
- R7. The MCP server's catalog is authoritative — the same list the validator's allowlist is derived from. There is exactly one source of truth for "what shadcn primitives exist in this system."

**Substrate continuity**

- R10. `apps/computer/src/iframe-shell/`, `apps/computer/src/applets/`, the sucrase / esbuild-wasm transform pipeline, the host-applet RPC protocol, the vendored React/shadcn/recharts/leaflet bundle, and the leaflet CDN compatibility shim all remain in place. No deletion of these surfaces is part of this brainstorm.
- R11. Form-state persistence, Refresh chrome, favorite/share/title/version chrome, and provenance metadata are unchanged. The visible artifact experience for end users is identical except for higher-quality content.
- R12. Existing in-flight applets render under the new validator if they comply with the allowlist; non-compliant in-flight applets are regenerated by re-prompting the agent.

**Map**

- R13. The interactive map continues to render inside the iframe runtime via the vendored leaflet. `HostMap` is the sole non-shadcn entry on the allowlist. Moving the map to a host-rendered React portal outside the iframe is out of v1.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Given the agent emits `import { Calendar } from "lucide-react"`, when save-artifact runs validation, the save is rejected with a structured error naming `lucide-react` as a disallowed import.

- AE2. **Covers R3, R9.** Given the agent emits `<div className="bg-white border rounded-lg p-4 shadow-sm">` instead of `<Card>`, when save-artifact runs validation, the save is rejected with a structured error that suggests `<Card>` as the shadcn equivalent.

- AE3. **Covers R4.** Given the agent emits `import { LineChart } from "recharts"` and renders `<LineChart>` outside any `<ChartContainer>`, when save-artifact runs validation, the save is rejected with a structured error naming the missing `<ChartContainer>` wrapper.

- AE4. **Covers R4.** Given the agent emits the same `<LineChart>` nested inside `<ChartContainer config={...}>`, when save-artifact runs validation, the save passes.

- AE5. **Covers R6, R7.** Given the agent calls the shadcn MCP `search_registry` tool with the query "dropdown", when the tool returns, the response lists `Select`, `DropdownMenu`, and `Combobox` with their import paths and a one-line description of each.

- AE6. **Covers R10, R11, R12.** Given a previously-shipped applet that imports only from the new allowlist, when reopened after the validator tightens, the applet renders identically to before with no regression in form state, refresh behavior, or chrome.

- AE7. **Covers R8.** Given a product need arises for `<Calendar>` that the current allowlist does not include, when the operator opens a host PR adding it and the PR merges, then on the next agent run the agent can call shadcn MCP `get_component_source` on `Calendar` and the validator accepts it on save.

- AE8. **Covers R13.** Given the agent emits an artifact containing `<HostMap markers={...} />`, when save-artifact runs validation, the save passes and the artifact renders the map inside the iframe via the existing leaflet path.

---

## Visual Aid

| Layer                                                   | Today                                                                              | After this brainstorm                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authoring surface                                       | TSX with broad import allowlist (shadcn + recharts + leaflet + utilities + ad-hoc) | TSX with shadcn-only allowlist + recharts-via-ChartContainer + React core + HostMap           |
| Catalog discovery                                       | None — agent guesses primitives and prop shapes                                    | shadcn MCP server (`list_components`, `get_component_source`, `get_block`, `search_registry`) |
| Hand-rolled styling                                     | Tolerated (`<div className="card-ish">` alongside real shadcn)                     | Rejected at save time when a shadcn equivalent exists                                         |
| iframe-shell, sucrase, vendored deps, RPC, leaflet shim | Present                                                                            | Present, unchanged                                                                            |
| Validator                                               | Loose import allowlist                                                             | Tight import allowlist + ad-hoc-style detection + structured errors                           |
| Map renderer                                            | Vendored leaflet inside iframe                                                     | Vendored leaflet inside iframe (unchanged)                                                    |
| v0 Platform API                                         | Not used                                                                           | Not used — parked as future escalation option                                                 |

---

## Success Criteria

- Artifact outputs from the Computer agent are qualitatively closer to v0-quality on the four "bad" axes (ugly, picks wrong UI shape, fails, slow). The two axes most directly addressed (ugly, picks wrong UI shape) are observably better in a side-by-side comparison of artifacts generated before vs after the change against the same prompts.
- Zero artifacts ship with hand-rolled card / button / dialog / form approximations of shadcn primitives. The validator catches them at save time.
- The Computer agent demonstrably calls shadcn MCP tools during artifact generation in production traces within the first week post-launch.
- The iframe-shell runtime, sucrase pipeline, vendored deps, host-applet RPC, and leaflet shim remain in place with no regression in render reliability, form-state persistence, or refresh behavior.
- The morning 2026-05-12 brainstorm (`docs/brainstorms/2026-05-12-computer-html-artifact-substrate-requirements.md`) and morning plan (`docs/plans/2026-05-12-002-feat-computer-artifact-kinds-plan.md`) are marked superseded by this document in their headers, and `ce-plan` is run fresh against this brainstorm.
- A reader of this doc and one follow-on planning doc can implement v1 without re-litigating TSX-vs-HTML, vocabulary scope, or substrate-slim scope.

---

## Scope Boundaries

**Deferred for later (post-v1):**

- Moving the interactive map out of the iframe into a host-rendered React portal. The leaflet CDN shim and vendored leaflet stay until product evidence justifies the portal redesign.
- Slimming the iframe-shell / sucrase / RPC / vendored-deps substrate. Pure hygiene; revisit when a concrete bug or velocity hit motivates it.
- Adding shadcn primitives that are not already part of the official shadcn registry. New host components are added on real-evidence demand only.
- Calling the v0 Platform API as an escalation tool when the agent gets stuck. Park until a week of shipped outputs proves whether the validator-plus-MCP combination still leaves quality below bar.
- Compound artifacts that mix narrative text and interactive components in one artifact. If a result needs both, the agent emits two artifacts. (Inherited from morning brainstorm; carries forward unchanged.)

**Outside this product's identity:**

- v0 Platform API as a primary runtime generation tool. v0 returns TSX it cannot wire to the user's recipe outputs, so the agent would still have to wire data afterward — saving no work. Adopting it now would re-create a multi-step draft-then-reinject loop the agent already handles in one pass.
- bolt.diy / OpenUI / OpenHands or any other OSS v0-alike adopted as a substrate or authoring surface. These tools solve "developer authoring an app" with a human in the loop. The Computer use case is "agent authoring an artifact" with no human author. Importing them would add an editor surface there is no end user to drive.
- HTML payload kind. The morning brainstorm's two-kind model is rejected — agent-authored HTML against a semantic class vocabulary is strictly worse than agent-authored TSX against shadcn primitives, because the agent loses access to component behavior, accessibility, and design-token coherence that shadcn brings for free.
- Killing or replacing the TSX execution path. v1+ keeps TSX as the only authoring surface.
- A JSON-component-tree authoring surface as an alternative to TSX. Rejected for the same reason as HTML: TSX is the agent's strongest authoring surface and the validator can keep it safe.
- A custom Vercel-trained or fine-tuned model swap. The visual-quality lift in this brainstorm comes from constraining the vocabulary, not from changing models. Revisit only if the constrained-vocabulary version still underperforms after a week of shipped outputs.

---

## Key Decisions

- **TSX runtime stays.** Reverses the morning 2026-05-12 brainstorm's central decision. Rationale: TSX-with-shadcn is the agent's strongest authoring surface; HTML-with-semantic-classes would require teaching the agent a new vocabulary while losing shadcn's component behavior, accessibility, and theming. The substrate cost is real but is not the dominant cause of bad outputs.

- **shadcn is the only allowed component vocabulary.** Rationale: visual quality from v0 / Replit / bolt.diy comes from a curated, consistent component vocabulary, not from a specialized model alone. Constraining the allowlist gives that benefit without changing models.

- **shadcn MCP is the catalog discovery mechanism.** Rationale: the agent must know what primitives exist and what their prop shapes look like. Without a catalog tool the agent guesses; with it the agent looks up. Same model, much better information.

- **The map is the sole non-shadcn special, and stays in the iframe.** Rationale: shadcn ships no map primitive. The existing leaflet-in-iframe path works today. A host-rendered map portal is a worthwhile follow-up but its design surface (iframe-host bridge for declarative map embedding) is non-trivial and would conflate "fix bad outputs" with "redesign map rendering."

- **v0 Platform API is not adopted for v1.** Rationale: v0 returns TSX it cannot connect to the user's recipe outputs, so the agent would still have to wire data afterward — saving no work. Parked as a future escalation if the constrained-vocabulary version still underperforms.

- **The morning 2026-05-12 brainstorm and the 2026-05-12-002 plan are superseded.** Rationale: their central decision (kill TSX, add HTML payload kind) is now reversed. They need a `Superseded by:` header pointing at this document and should not feed `ce-plan` going forward.

- **Substrate slim is deferred.** Rationale: the leaflet shim and vendored deps are not actively causing bugs. Bundling hygiene with vocabulary tightening would expand the change surface without moving any of the "bad output" needles.

---

## Dependencies / Assumptions

- The existing TSX execution path (`apps/computer/src/iframe-shell/`, sucrase, vendored React/shadcn/recharts/leaflet, host-applet RPC, leaflet CDN shim) continues to work and remains the runtime for all artifacts.
- The Vercel AI SDK / AI Elements chat-rendering layer in `apps/computer` (from the 2026-05-09 brainstorm) continues to render artifact previews inline in chat messages. This brainstorm does not change the chat-side surface.
- The Computer agent's existing `save-app` tool is the right hook to evolve into the tightened save-artifact validator. The constrained-import-surface validator that the morning brainstorm planned to delete is _retained_ and _tightened_, not rebuilt from scratch.
- Existing per-user EFS-backed storage stays as the artifact storage location.
- shadcn ships an official MCP server (`@shadcn/mcp` or a current community equivalent) that the Computer agent can connect to. If the official server's tool surface is insufficient, a thin host wrapper exposing the same shape is acceptable.
- recharts is already bundled in the existing vendored deps and continues to back shadcn's chart vocabulary. No additional charting dependency is added.
- v0 Platform API remains available as a future-escalation option if the validator-plus-MCP combination still leaves the agent producing low-quality output after a week of shipped outputs.

---

## Outstanding Questions

### Resolve Before Planning

_None. Brainstorm is closed._

### Deferred to Planning

- [Affects R4][Technical] Exact mechanism for the "recharts only inside ChartContainer" check — AST walk over the TSX, regex pre-check followed by a stricter AST validation, or structural pattern match against shadcn's chart pattern. Planning should pick.
- [Affects R3][Technical] How the validator detects "hand-rolled shadcn approximation" patterns (e.g., `<div className="bg-white rounded shadow">`) — heuristic className-token match, strict allowlist on `className` tokens combined with structural rules, or a denied-token list. Planning should pick.
- [Affects R6, R7][Technical] Whether to host shadcn MCP in-process inside the agent runtime container or as a separate Lambda. Affects cold-start latency for catalog queries and the operational surface area.
- [Affects R8][Technical] Where the allowlist is declared (one TS file, a generated manifest, or both) so the validator and the MCP server stay in lockstep.
- [Affects R9][Technical] Exact structured-error shape returned to the agent on validation failure so retries are short and targeted.
- [Affects R12][Technical] Migration sweep for existing in-flight applets — automated regeneration on next agent touch, or a one-shot re-prompt sweep at deploy time.
- [Affects R13][Needs research] Confirm the vendored leaflet inside the iframe still works under the current monorepo state; no leaflet-specific regressions should land along with this change.
