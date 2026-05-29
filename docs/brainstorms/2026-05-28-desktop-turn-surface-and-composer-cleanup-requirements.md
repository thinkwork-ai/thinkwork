# Desktop turn-surface + composer cleanup — Requirements

**Date:** 2026-05-28
**Scope:** Standard (`apps/spaces` renderer — UI cleanup + one new inspection feature)
**Status:** Ready for planning

## Problem

Three rough edges in the ThinkWork Spaces desktop app:

1. **Composer toolbar order.** The Space dropdown ("Default") sits first in the toolbar control row, ahead of the @ mention and paperclip icons. It should come after the attachment (paperclip) icon.

2. **Turn rendering is inconsistent and noisy.** While a turn runs, three separate surfaces stack: a collapsible **Thinking** section, a **Processing…** shimmer, and a boxed **Local Pi console** of raw sidecar log lines (`06:38:25 PM info pi-sidecar …`). After the turn completes, the raw console log still renders in a bordered box *after* the final assistant message. The Codex desktop app does this far more cleanly: a single collapsible **"Worked for 3m 27s"** header with a full-width rule, human-readable steps/thinking/tool-calls when expanded, and the final answer as clean inline prose — never in a box.

3. **No way to see the exact system prompt.** There's no surface to inspect what was actually passed to the model for a thread (the composed AGENTS.md + SPACE.md + USER.md). Seeing the *exact* prompt — not a re-derivation — is a valuable debugging/understanding aid.

## Goal

Collapse the turn-progress UI into one Codex-style surface, fix the composer toolbar order, and add a "System Prompt" viewer to the thread menu that shows the **exact** prompt the model received. The conversation should read as clean prose with one tidy, collapsible progress affordance per turn.

## Confirmed decisions

- **Composer order:** `@ mention → paperclip → Space dropdown → send`. (Currently `Space dropdown → @ mention → paperclip → send`.)
- **One turn surface — relabel + merge, not a rebuild.** The existing `ThreadTurnActivity` collapsible (with its tool-call rows — "Using mcp…", "Applying code changes", etc.) is good and stays. The change is to its header chrome and what feeds its rows:
  - Running state: header reads **"Working…"** rendered in the **shimmer style** (the existing animated-shimmer treatment) — **no brain icon, no "Thinking" label**. This header replaces the separate "Processing…" shimmer entirely.
  - Completed state: header collapses and relabels to **"Worked for Xm Ys"**, collapsed by default, with the results below.
- **Merge Pi outputs into the same row list.** Local-Pi sidecar events become step rows in the *same* activity list as the existing tool rows — not a separate boxed console. The boxed "Local Pi console" goes away; its content is represented as merged human-readable rows.
- **Expanded content = human-readable steps** (e.g. "Using mcp…", "Searched the web", "Applying code changes"). Derived from turn events/tool-invocations, now including local-Pi events.
- **Final assistant message renders as clean inline prose**, never inside a box.
- **Raw sidecar logs stay reachable behind a quiet "view console log" toggle** inside the expanded surface — shown only when console/log data exists (local-Pi turns), not default-visible, not boxed. Intended to be removed once local Pi is stable.
- **Applies to all agent turns** (cloud/managed and desktop-local Pi), for one consistent surface everywhere.
- **System Prompt viewer** added to the thread "…" menu (alongside Archive / Delete):
  - Shows the **EXACT system prompt that was sent to the model** for the thread — read from the persisted prompt, **not re-derived** from current workspace files. "We should know the system prompt, not recreate it."
  - **One concatenated read-only document** (the full prompt string as the model received it), in a CodeMirror viewer with **no file tree**.
  - Source: the persisted composed prompt (see Notes — `thread_turns.system_prompt` already stores this for cloud turns; local Pi must be wired to capture it from the Pi SDK).
  - Shows the prompt for the **latest turn** of the thread by default. (Per-turn selection is a possible later enhancement; the prompt is usually stable across a thread.)
  - Available on **all threads** (managed + local Pi); presented in a **dialog** reusing the existing Space-file-viewer dialog pattern.
  - Read-only inspection only — no editing, no save.

## User-facing behavior

### Composer
- The Space picker (`<Select>` with planet icon + "Default") moves to the right of the paperclip, immediately before the send button.
- No behavioral change to the dropdown itself — same options, same selection logic, same conditional visibility (`spaces.length > 0 && selectedSpaceId && onSelectedSpaceChange`).

### Turn surface (during a run)
- A single collapsible header reads **"Working…"** in the shimmer style (no brain icon, no "Thinking" label), with a live elapsed timer.
- Expanding shows steps as they stream in — the existing tool-call rows plus merged local-Pi event rows.
- No separate "Processing…" shimmer; no boxed console rendered alongside the message.

### Turn surface (after completion)
- Header settles to **"Worked for Xm Ys"**, collapsed by default, results below.
- Expanding shows the chronological human-readable steps for that turn (tool calls + merged Pi events).
- A quiet **"view console log"** affordance inside the expanded surface reveals raw sidecar log lines for debugging, shown only when such data exists. Collapsed by default; not in a bordered box.
- The final assistant message renders as inline prose directly, with no surrounding box.

### System Prompt viewer
- The thread "…" menu gains a **"System Prompt"** item (with an icon), above the destructive "Delete thread".
- Selecting it opens a dialog showing a read-only CodeMirror viewer (no file tree) with the **exact** composed system prompt the model received for the latest turn — a single concatenated document with markdown highlighting.
- Content is read-only (no editing, no save). A copy-to-clipboard affordance is reasonable.
- If no prompt has been captured yet for the thread (e.g. no completed turn), the dialog shows an empty/"not captured yet" state rather than erroring.

## Success criteria

- Composer toolbar order is `@ → paperclip → Space dropdown → send`.
- A running turn shows exactly **one** progress surface (no Thinking + Processing + console triple-stack).
- Completed turns show a Codex-style "Worked for Xm Ys" collapsible header with a rule, and the final message as un-boxed prose.
- Raw sidecar logs are reachable but not shown by default; nothing renders the console in a bordered box after the message.
- Behavior is consistent across cloud/managed turns and desktop-local Pi turns.
- The thread "…" menu has a "System Prompt" item that opens a read-only, tree-less viewer showing the **exact persisted system prompt** sent to the model — verifiably the real string, not a re-derivation. Works for both managed and local-Pi threads.

## Scope boundaries

**In scope**
- `apps/spaces/src/components/workbench/SpacesComposer.tsx` toolbar reorder.
- Turn-progress rendering in `apps/spaces/src/components/workbench/TaskThreadView.tsx`: consolidating `ThinkingRow`/`ThreadTurnActivity`, `ProcessingShimmer`, and the in-flight `LocalPiConsole` into one surface; "Worked for Xs" header + live timer; steps-by-default; console-log toggle; un-boxed final message.
- System Prompt viewer: new menu item in `ThreadDetailActions` + a dialog mounting a read-only CodeMirror viewer (no tree) that displays the persisted exact system prompt.
- **Exposing the persisted system prompt to the client**: a GraphQL field/query for `thread_turns.system_prompt` (and/or an IPC path for local Pi). Wiring the local-Pi sidecar to capture the SDK's composed prompt if it isn't already persisted.

**Out of scope**
- What tools/steps the agent actually runs (no change to agent behavior).
- The sidecar/main-process logging itself — only *how* logs are surfaced in the thread.
- Cloud-turn backend behavior beyond surfacing the already-captured prompt; this is presentation + a read path.
- Removing the console-log toggle (deferred — revisit once local Pi is stable).
- **Editing** the system prompt / prompt files from this viewer — read-only inspection only.
- Per-turn prompt selection UI (show latest turn for v1; revisit if prompts are observed drifting within a thread).

## Open questions / risks

- **Local-Pi capture.** Cloud turns already persist `thread_turns.system_prompt` at finalize. The **desktop-local Pi** path likely does not yet persist it — but the Pi SDK (`@earendil-works/pi-coding-agent`) exposes **`session.agent.state.systemPrompt`** (a readable composed-prompt string; confirmed in https://pi.dev/docs/latest/sdk). So the sidecar should read `state.systemPrompt` after session creation and persist it into the turn record (same `system_prompt` column). Caveat from the docs: `state.systemPrompt` reflects the composed prompt but may not capture post-compaction transformations — acceptable for this viewer's purpose (showing the AGENTS.md/SPACE.md/USER.md composition the agent started with).
- **Read path.** No client-facing GraphQL field currently exposes `thread_turns.system_prompt`; a resolver (or IPC bridge for local) needs adding.

## Notes for planning

- The boxed **Local Pi console** is **not in `main`** — it lives in the in-flight `local-pi-sidecar` work (the Canary build in the screenshots). This cleanup spans both the main-tree Thinking/Processing code and that in-flight console code; sequence accordingly to avoid a merge collision.
- Turn-surface building blocks to reuse rather than rebuild:
  - `actionRowsForTurn(turn, usage)` (`TaskThreadView.tsx:2385`) already derives human-readable step rows from events + tool invocations.
  - `formatTurnDuration(turn)` (`TaskThreadView.tsx:2654`) and `turnSummary` (`:2624`) already compute duration/summary text — the basis for "Worked for Xm Ys".
  - `ThinkingRow` (`:2061`) / `ActionRow` (`:2102`) are the current collapsible + row primitives.
  - `Reasoning` / `ReasoningTrigger` in `apps/spaces/src/components/ai-elements/reasoning.tsx` already track streaming duration — candidate base for the live timer.
- `ProcessingShimmer` (`:1151`) and its two render sites (`:390`, `:965`) are removed/replaced by the running-state header.
- Composer edit is mechanical: move the `<Select>` block (`SpacesComposer.tsx:245-273`) to after `<PromptInputAttachButton />` (`:284`).
- System Prompt viewer — data already exists server-side:
  - **`thread_turns.system_prompt`** (TEXT) in `packages/database-pg/src/schema/scheduled-jobs.ts` stores the **actual composed prompt string sent to the model**, captured at finalize (`packages/api/src/lib/chat-finalize/process-finalize.ts`; AgentCore returns `composed_system_prompt` per `packages/api/src/lib/evals/agentcore-direct.ts`). This is the source of truth — no re-derivation needed.
  - No GraphQL field currently exposes it → add a resolver (e.g. on the turn type) returning `system_prompt`, plus an IPC path for the local-Pi/desktop case.
  - UI pieces: add a `DropdownMenuItem` ("System Prompt") to `ThreadDetailActions` (`apps/spaces/src/components/workbench/ThreadDetailActions.tsx:90-122`, before the separator). `packages/workspace-editor` is newly scaffolded (CodeMirror via `@uiw/react-codemirror`, `@codemirror/lang-markdown`) but its editor component is still a stub — either finish a minimal read-only viewer there or mount `@uiw/react-codemirror` directly in a dialog mirroring `WorkspaceFilesPanel.tsx`'s shell minus the tree.
  - **File scopes** (context only — we display the composed result, not these directly): `USER.md` per-user (server-managed), `SPACE.md` per-Space, `AGENTS.md` per-agent/workspace (composed in `packages/api/src/workspace-files.ts`).
