---
title: "feat: U12 — `write_memory` path parameter (no ETag)"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: U12 — `write_memory` path parameter (no ETag)

## Overview

Replace the basename-`Literal` parameter on the Strands `write_memory` runtime tool with a path-validated `str` parameter, so a sub-agent rooted at `{agent}/expenses/` can write to `{agent}/expenses/memory/lessons.md` instead of the parent agent's root memory. Path is **relative from the agent root** per Key Decisions §008 (line 165). Validation rejects path traversal, Unicode bypass, dot segments, OS separators, reserved-name misuse, and depth > 5 folder segments before the trailing `memory/` directory. Basename remains restricted to the existing three writable files via regex alternation.

This is a narrowed slice of master plan §008 U12 (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md` lines 730-775). **ETag-guarded optimistic concurrency is explicitly deferred to a follow-up unit** — see Scope Boundaries.

---

## Problem Frame

Today `write_memory(name: MemoryBasename, content: str)` accepts only the three basenames (`lessons.md`, `preferences.md`, `contacts.md`) and unconditionally prepends `memory/`. Once the U9 spawn follow-up ships and a sub-agent rooted at `{agent}/expenses/` is invoked, that sub-agent's `write_memory("lessons.md", ...)` call still POSTs to `path: "memory/lessons.md"` — i.e., it overwrites the **parent** agent's root lessons file, not the sub-agent's own scope. The runtime needs a path parameter the sub-agent can fill with `expenses/memory/lessons.md` to scope correctly.

The skill-script side (`packages/skill-catalog/workspace-memory/scripts/memory.py:64`) already accepts `path: str` but only validates `path.startswith("memory/")` — that surface is out of scope for this PR (it's reached via the run_skill_dispatcher, not Strands' direct tool call).

Two adjustments vs the master plan U12 unit body:

1. **Path is relative from the agent root.** Master plan U12 Approach (line 753) says "relative paths bind to the sub-agent's folder, absolute `memory/...` binds to agent root." That contradicts Key Decisions §008 line 165 ("relative from the agent root"). Honor the Key Decision per repo precedent (U9 made the same call on its depth cap). The sub-agent is responsible for composing `{folder}/memory/{basename}.md` itself; no hidden tool-context magic.
2. **No ETag concurrency.** Master plan U12 bundles ETag/optimistic-locking with the path param. ETag requires changes to `packages/api/workspace-files.ts` (TS Lambda handler, separate review surface) and is a different concurrency concern. Ship the path API first; layer concurrency on top in a separate plan-008 follow-up.

---

## Requirements Trace

- R1. Sub-agent at `{agent}/<folder>/` can write to `{agent}/<folder>/memory/{basename}.md` via `write_memory("<folder>/memory/{basename}.md", content)`. (Master R5, R25; Key Decisions §008 line 165.)
- R2. Parent agent at `{agent}/` retains backward-compatible behavior — `write_memory("memory/{basename}.md", content)` lands at `{agent}/memory/{basename}.md`.
- R3. Path validation rejects traversal (`..`), dot-segments (`./`, `/.`), OS separators (`\`), absolute paths (leading `/`), and double slashes (`//`).
- R4. Unicode bypass attempts are rejected — input is NFKC-normalized before regex match.
- R5. Reserved folder names (`memory`, `skills`) cannot appear as folder-prefix segments — only the trailing `memory/` directly before basename is the canonical destination.
- R6. Depth cap: at most 5 folder segments before `memory/` (matches the U9 cap from Key Decisions §008).
- R7. Basename must be one of `lessons.md`, `preferences.md`, `contacts.md` — enforced via regex alternation, not Literal.
- R8. No skill-catalog script breaks. Audit confirms only `packages/skill-catalog/workspace-memory/scripts/memory.py` reuses the name `workspace_memory_write` (different surface, different signature, out of scope).
- R9. The TS `MemoryBasename` / `AGENT_WRITABLE_MEMORY_BASENAMES` exports in `@thinkwork/workspace-defaults` remain exported and unchanged (still document the writable-basename allowlist — only consumed within `packages/workspace-defaults/src/index.ts` itself).

**Origin actors:** A4 (agent runtime), A5 (sub-agent).
**Origin flows:** F3 (sub-agent delegation — write-side enabler).

---

## Scope Boundaries

- Not extending the skill-script `workspace_memory_write` (`packages/skill-catalog/workspace-memory/scripts/memory.py`). That's a different surface reached via `run_skill_dispatcher`; if its validation needs to match, that's a separate plan-008 unit.
- Not touching `recall_memory` / Hindsight read-side path support. Memory recall already accepts paths via Hindsight; no parity work needed in this PR.
- Not changing any UI surface. The agent-builder's memory section, if it exposes write paths, stays as-is.
- Not refactoring `write_memory_tool.py` to a factory closure (per `feedback_completion_callback_snapshot_pattern`). The current per-call `os.environ.get(...)` reads happen INSIDE the agent loop — env is still live during a tool call (the shadow-bug case in PR #563 was about post-callback handlers, not in-loop tool calls). Factory refactor is a follow-up if a real shadow bug surfaces.
- Not touching `_boot_assert.EXPECTED_CONTAINER_SOURCES` — `write_memory_tool` is already listed.

### Deferred to Follow-Up Work

- **ETag-guarded optimistic concurrency** for memory writes (master plan U12 Approach line 752, Key Decisions §008 line 160). Ship as a follow-up plan-008 unit that touches `packages/api/workspace-files.ts` `put` action handler. Without ETag, two concurrent sub-agent writes can silently last-writer-win. v1 risk is low because Bedrock invocations are serialized per agent today, but the concurrency window opens once parallel sub-agent spawns land.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py` — current implementation:
  - `MemoryBasename = Literal["lessons.md", "preferences.md", "contacts.md"]` at line 32.
  - `@tool` decorator at line 56; `name: MemoryBasename` parameter at line 57.
  - Defensive enum check at line 83 (`if name not in (...)`).
  - `rel_path = f"memory/{name}"` at line 97 — hard-coded prefix.
  - Per-call env reads at lines 87-92 (`os.environ.get("TENANT_ID")`, etc.).
- `packages/agentcore-strands/agent-container/test_write_memory_tool.py` — current tests:
  - `test_valid_basename_posts_with_memory_prefix` — happy path with `name="lessons.md"`.
  - `test_invalid_basename_rejected_before_http_call` — tries `name="../GUARDRAILS.md"` (Literal rejects).
  - `test_missing_runtime_config_returns_error_without_crashing` — env-strip case.
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py` — exports `RESERVED_FOLDER_NAMES = frozenset({"memory", "skills"})` (Plan §008 U8). Reuse this constant for prefix-segment validation.
- `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:75-130` — recently-shipped `validate_path` from U9 covers the same depth-5 cap, traversal/abs/reserved-segment checks, and trailing-slash normalization. The U12 validator can mirror its structure but adds the trailing `memory/<basename>` constraint.
- `packages/workspace-defaults/src/index.ts:47-56` — `AGENT_WRITABLE_MEMORY_BASENAMES` and `MemoryBasename` TS type. Single-module consumer. No ripple needed.
- `packages/skill-catalog/workspace-memory/scripts/memory.py:64-82` — adjacent `workspace_memory_write` with `path.startswith("memory/")` check. **Out of scope** but referenced for surface comparison.

### Institutional Learnings

- `feedback_dont_overgate_baseline_agent_capability` — runtime tool capability is baseline; do not add admin-approval ceremony.
- `feedback_completion_callback_snapshot_pattern` — relevant for factory closures at coroutine entry. Per-call tool reads of `os.environ` are NOT the shadow-bug pattern; left as-is to keep U12 narrow.
- `feedback_workspace_user_md_server_managed` — USER.md is server-managed; the agent's writable-memory paths under `memory/` are NOT user-profile data.
- `feedback_ship_inert_pattern` — U12 ships LIVE (not inert); the @tool is reachable today by parent agents and will be reachable by sub-agents once U9-spawn-PR lands. The path API is enabled now even though no sub-agent caller exists yet — that's the standard "API-first, consumer-second" sequencing.
- `agentcore-completion-callback-env-shadowing-2026-04-25.md` — env-shadow bug specific to post-callback handlers. Tool calls during the agent loop are NOT affected.
- `dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md` — `_boot_assert` already lists `write_memory_tool`; no new entry needed.

### External References

- None — well-patterned local work; no external research warranted.

---

## Key Technical Decisions

- **Canonical path regex** (after NFKC normalization): `^([a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*){0,4}/)?memory/(lessons|preferences|contacts)\.md$`. Explicit anchors at both ends prevent suffix-extension attacks (`memory/lessons.md/foo`). The `(0,4)` quantifier on folder repetition gives at most 5 folder segments before `memory/` — that count includes the leading folder, matching the U9 depth-5 cap from Key Decisions §008.
- **NFKC first, then validate** — `unicodedata.normalize("NFKC", path)` before regex match. Rejects fullwidth and Cyrillic look-alikes (`ｍemory`, `mеmory`) by collapsing them to the canonical ASCII form (which then fails the regex if the original was non-canonical, OR matches if the user genuinely meant ASCII memory but typed it via an IME). NFKC is the right normalization form for this validator because the system itself stores ASCII paths.
- **Reserved-name segments** in folder prefix (everything before the trailing `memory/`) are rejected. The canonical `memory/` directly before basename is the ONLY allowed reserved-name use. Implementation: split the folder prefix on `/`, reject if any segment ∈ `RESERVED_FOLDER_NAMES`. The trailing `memory/` is consumed by the regex, so it never enters the segment-iteration check.
- **Literal trailing-slash strip is NOT applied.** Unlike U9's `validate_path`, the path here always ends in a basename. A trailing `/` would mean "directory" not "file" and is correctly rejected by the regex.
- **Path is `str`, not `Literal`.** Strands' tool-schema generation will produce a string parameter, dropping the schema-level allowlist. The defense moves entirely into runtime validation. This is a deliberate trade — the LLM gains expressiveness for sub-agent paths; the runtime gains the validation responsibility. Comparable to U9's `validate_path` shift.
- **Backward compat is achieved via the regex matching the root case.** A parent agent calling `write_memory("memory/lessons.md", ...)` matches the optional folder-prefix group as empty and lands at `{agent}/memory/lessons.md` — same as today.
- **Param name changes from `name` to `path`.** Existing tests update their kwargs; the LLM's tool-schema param name changes from `name` → `path`. No external callers (skill-catalog grep confirms separation; TS audit confirms `MemoryBasename` has no consumers).
- **ETag deferred** — explicitly out of scope. Documented in Scope Boundaries with rationale.

---

## Open Questions

### Resolved During Planning

- "Should the path validator share `validate_path` with U9's `delegate_to_workspace_tool`?" — **No.** They share concepts (depth cap, reserved-segment check, traversal rejection) but disagree on shape: U9 validates a folder path that ends without slash; U12 validates a file path that ends in a memory basename. Different terminal-state constraints. Mirroring the structure (NFKC + segment-walk + depth cap + regex anchor) is enough — extracting a shared helper today would over-abstract for two callers. Revisit if a third consumer surfaces.
- "Should the canonical `memory/` itself be checked against `RESERVED_FOLDER_NAMES`?" — **No.** It IS one of the reserved names, but its presence as the trailing directory is the canonical destination. The regex consumes the trailing `memory/<basename>` so the segment-iteration only sees the folder prefix; the reserved-segment check there correctly rejects only PREFIX uses (`memory/foo/memory/lessons.md` → fails on the leading `memory` segment).
- "What does the @tool docstring say about sub-agent context?" — Documented inline: the path is from the agent root, not the current folder, and the sub-agent should compose `{folder}/memory/{basename}.md` explicitly.

### Deferred to Implementation

- Exact error-message strings for each rejection class (the implementer picks operator-readable phrasing).
- Whether to import `RESERVED_FOLDER_NAMES` from `skill_resolver` or `agents_md_parser` (both export the same frozenset; the implementer picks based on which import already exists in the test conftest path).

---

## Implementation Units

- U1. **`write_memory` path-parameter refactor**

**Goal:** Replace the basename-`Literal` parameter with a path-validated string. Validate via NFKC + regex + reserved-segment check + depth cap. Update the @tool docstring. Migrate existing tests and add new path-bypass coverage.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9.

**Dependencies:** None within this plan. External: U8 (`RESERVED_FOLDER_NAMES`) shipped on origin/main.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py` — replace `name: MemoryBasename` with `path: str`, drop `MemoryBasename` Literal, add `_validate_memory_path(path) -> str` pure function, update docstring, drop the `rel_path = f"memory/{name}"` hard-prefix in favor of using the validated path directly.
- Modify: `packages/agentcore-strands/agent-container/test_write_memory_tool.py` — update existing happy-path test (kwargs `name="lessons.md"` → `path="memory/lessons.md"`), update existing reject test, update env-strip test. Add new test class for `_validate_memory_path` covering each documented bypass class.

**Approach:**
- **Validator is a pure module-level function** so tests don't need to mock the network. Returns the normalized path on success, raises `ValueError` with operator-readable message on failure.
- **Validation order (cheap → expensive, no I/O):**
  1. `path is None` or `path.strip() == ""` → reject.
  2. `path.startswith("/")` → reject (absolute).
  3. `\\` in path → reject (OS separator).
  4. `unicodedata.normalize("NFKC", path)` — apply.
  5. `..`, `./`, `/.`, `//` substring presence → reject.
  6. Regex match against the canonical pattern → reject if no match.
  7. Split the captured folder prefix on `/`, iterate segments, reject if any ∈ `RESERVED_FOLDER_NAMES`.
- **Tool body** calls validator first, then proceeds with the existing `_post_put` flow using the validated path directly (no string concatenation).
- **Docstring** explicitly tells the LLM:
  - `path` is from the agent root, not from the current folder
  - Sub-agent example: `path="expenses/memory/lessons.md"`
  - Parent-agent example: `path="memory/lessons.md"`
  - Allowed basenames: `lessons.md`, `preferences.md`, `contacts.md`
  - Depth cap 5

**Execution note:** Implement test-first for `_validate_memory_path` (pure function, fast feedback, contract is the security boundary). The composer-call body is unchanged from current behavior — its tests migrate kwargs only.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:75-130` — `validate_path` shape (NFKC, segment iteration, depth cap, traversal/abs rejection). U12's validator differs only in the trailing `memory/<basename>` regex.
- `packages/agentcore-strands/agent-container/container-sources/skill_resolver.py:104-133` — `_normalize_folder_path` reserved-segment iteration pattern.
- Existing `_post_put` body in `write_memory_tool.py` — keep as-is.

**Test scenarios:**

*Happy path:*
- Parent root: `_validate_memory_path("memory/lessons.md")` → returns `"memory/lessons.md"`.
- Parent root: `_validate_memory_path("memory/preferences.md")` → returns same.
- Parent root: `_validate_memory_path("memory/contacts.md")` → returns same.
- Sub-agent depth 1: `_validate_memory_path("expenses/memory/lessons.md")` → returns same.
- Sub-agent depth 2: `_validate_memory_path("support/escalation/memory/lessons.md")` → returns same.
- Sub-agent depth 5 (max): `_validate_memory_path("a/b/c/d/e/memory/lessons.md")` → returns same.
- Tool-end: `write_memory(path="memory/lessons.md", content="x")` → posts `{action: "put", path: "memory/lessons.md", content: "x"}` (mirrors current `test_valid_basename_posts_with_memory_prefix`).
- Tool-end: `write_memory(path="expenses/memory/lessons.md", content="x")` → posts the sub-agent path verbatim.

*Edge cases:*
- Empty string → `ValueError` mentioning "empty".
- Whitespace-only after strip → `ValueError`.
- Trailing slash on path → `ValueError` (regex rejects, doesn't auto-strip).

*Error paths — traversal & separator:*
- `"../memory/lessons.md"` → `ValueError` mentioning "traversal".
- `"expenses/../memory/lessons.md"` → `ValueError`.
- `"expenses/./memory/lessons.md"` → `ValueError` (dot-segment).
- `"./memory/lessons.md"` → `ValueError`.
- `"/memory/lessons.md"` → `ValueError` mentioning "absolute".
- `"expenses\\memory\\lessons.md"` → `ValueError` mentioning "separator".
- `"expenses//memory/lessons.md"` → `ValueError` mentioning "double slash" or "empty segment".

*Error paths — basename allowlist:*
- `"memory/bogus.md"` → `ValueError` mentioning the allowed basenames.
- `"memory/lessons.txt"` → `ValueError`.
- `"memory/lessons"` → `ValueError`.
- `"memory/Lessons.md"` (capital) → `ValueError` (regex is lowercase-anchored).

*Error paths — reserved-name misuse:*
- `"skills/memory/lessons.md"` → `ValueError` mentioning "reserved" (skills as folder prefix).
- `"memory/memory/lessons.md"` → `ValueError` (memory used as folder prefix; only the trailing memory is allowed).
- `"expenses/skills/memory/lessons.md"` → `ValueError` (skills mid-prefix).

*Error paths — depth & shape:*
- Depth 6: `"a/b/c/d/e/f/memory/lessons.md"` → `ValueError` mentioning "depth" or "exceeds".
- Suffix extension: `"memory/lessons.md/foo"` → `ValueError`.
- Empty folder segment: `"a//b/memory/lessons.md"` → `ValueError`.

*Error paths — Unicode bypass:*
- Fullwidth m: `"ｍemory/lessons.md"` → `ValueError` (NFKC normalizes to `memory/lessons.md` which IS valid; the test should assert this collapses to canonical and succeeds, OR the implementer chooses to reject any non-ASCII input — pick one and document the choice).
- Cyrillic e in memory: `"memоry/lessons.md"` → `ValueError` (NFKC does NOT normalize Cyrillic to Latin; regex rejects).
- Embedded space: `"mem ory/lessons.md"` → `ValueError` (regex rejects).

**Note on Unicode behavior:** NFKC collapses fullwidth ASCII to standard ASCII, so `ｍemory` → `memory` and would PASS validation as a canonical write. NFKC does NOT translate Cyrillic look-alikes to Latin — those still fail the regex. Decision: accept the NFKC-normalized form (since downstream S3 keys are ASCII anyway), explicitly tested.

*Integration:*
- `_post_put` is called with the validated path verbatim (no `f"memory/{name}"` mangling).
- `urllib.request.urlopen` mock captures `body["path"] == "expenses/memory/lessons.md"` for sub-agent case.
- `urllib.request.urlopen` mock captures `body["path"] == "memory/lessons.md"` for parent case (backward compat).

**Verification:**
- All test scenarios pass via `uv run --no-project --with pytest --with strands-agents pytest packages/agentcore-strands/agent-container/test_write_memory_tool.py`.
- The 3 pre-existing strands-SDK test failures (verified pre-existing on origin/main per U9 review) remain unchanged in count.
- `ruff check` clean on changed files.
- `_boot_assert` smoke still passes (no module-list change needed).
- Skill-catalog audit clean: `grep -rn "write_memory\|workspace_memory_write" packages/skill-catalog` shows only `workspace-memory/scripts/memory.py` matches (a separate surface, out of scope per Scope Boundaries).

---

## System-Wide Impact

- **Interaction graph:** `write_memory` @tool is registered in `server.py`'s tool list; the agent loop is the only caller. No middleware, no callbacks, no observers.
- **Error propagation:** Path-validation `ValueError` is caught at the tool boundary and returned to the agent as a string error message (matches existing pattern of returning string from the @tool body, not raising). Or the implementer can choose to let `ValueError` propagate — the existing tool catches general `Exception` at line 113-119 already, so either shape works. Decide during implementation; document the choice.
- **State lifecycle risks:** None added. The `_post_put` semantics are unchanged — last-writer-wins remains the concurrency model (ETag deferred).
- **API surface parity:** The skill-script `workspace_memory_write` (out of scope) has weaker validation. If a follow-up unit aligns them, the regex can be lifted into a shared module then. For now they diverge intentionally.
- **Integration coverage:** The path-validation tests are fast pure-function tests; the tool-end integration tests use the existing urllib mock. No infrastructure dependencies.
- **Unchanged invariants:**
  - `_post_put` body shape (`{action, agentId, path, content}`) unchanged.
  - `/api/workspaces/files` PUT endpoint unchanged.
  - `_boot_assert.EXPECTED_CONTAINER_SOURCES` unchanged.
  - `MemoryBasename` TS type unchanged (still exported from `@thinkwork/workspace-defaults`).
  - The 3 writable basenames unchanged — same allowlist, just enforced differently.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The Strands `@tool` schema-rename from `name` to `path` could surprise an agent that has a cached tool schema | Tools are registered per turn; no caching across turns. The LLM sees the new schema on the very first turn after deploy. No migration needed. |
| Sub-agents pass folder-relative paths thinking they're sub-folder-relative | Docstring explicitly states "from agent root"; the U9 spawn-PR's `resolved_context` already includes `normalized_path` so the sub-agent's prompt builder can hint the prefix. |
| Last-writer-wins concurrency under parallel sub-agents | Documented in Scope Boundaries → ETag deferred follow-up. v1 risk acceptably low because Bedrock invocations serialize per agent today. |
| NFKC normalization for fullwidth ASCII silently accepts non-canonical input | Tested explicitly. The NFKC behavior is documented in Key Technical Decisions and asserted as the canonical-acceptance form. |
| Skill-catalog `workspace_memory_write` validates differently and could drift | Out of scope; flagged for a follow-up alignment unit if/when the skill-script needs sub-agent path support. |

---

## Documentation / Operational Notes

- Update no docs in this PR. The @tool docstring is the agent-facing contract; updating it is part of U1.
- After this lands, capture a note in `project_plan_008_progress.md` so the U9 spawn-PR follow-up knows sub-agent memory writes are scopable.

---

## Sources & References

- **Origin plan (master):** [docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md](docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md) (U12 unit body lines 730-775; Key Decisions §008 line 165).
- **Key Decision precedent (U9):** [docs/plans/2026-04-25-002-feat-u9-delegate-to-workspace-tool-plan.md](docs/plans/2026-04-25-002-feat-u9-delegate-to-workspace-tool-plan.md).
- Related code: `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py`, `delegate_to_workspace_tool.py`, `skill_resolver.py`.
- Related PRs (deps): #573 (U8 reserved-folder-names), #578 (U9 inert delegate).
- Memory: `feedback_completion_callback_snapshot_pattern`, `feedback_dont_overgate_baseline_agent_capability`, `feedback_workspace_user_md_server_managed`, `feedback_ship_inert_pattern`, `project_plan_008_progress`.
