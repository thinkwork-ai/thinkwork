# Residual review findings — `feat/u12-write-memory-path-param`

Source: ce-code-review run `20260425-da44a00f` (autofix mode).
Plan: `docs/plans/2026-04-25-003-feat-u12-write-memory-path-param-plan.md`.
Reviewers dispatched (9): correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, kieran-python, security, adversarial.
Four `safe_auto` cleanups applied as `fix(review): apply autofix feedback` before this record was written.

This file is the durable no-PR sink — once the PR opens, copy these items into the PR body under `## Residual Review Findings` and let CI / reviewers pick them up.

## Residual Review Findings

### P2

- **[P2][gated_auto → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:65` + `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:52` — Depth-cap constant drift vs U9** (maintainability, conf 60).
  Two `=5` constants for the same Key Decisions §008 policy: `_MAX_FOLDER_DEPTH = 5` here, `MAX_DEPTH = 5` in U9. A future cap change must touch both. Lift to `skill_resolver.MAX_FOLDER_DEPTH = 5` and import in both tool modules, or cross-reference with a comment forcing future cap-change PRs to update both.

- **[P2][advisory → human] cross-surface — `packages/skill-catalog/workspace-memory/scripts/memory.py:75`** (adversarial, conf 80).
  Surface drift: the skill-script `workspace_memory_write` retains looser validation (`path.startswith("memory/")` only). If a tenant has both surfaces enrolled (Strands @tool + skill-catalog `workspace_memory_write`), the LLM can route around U12's basename allowlist by switching tools mid-turn. Plan flagged this as out of scope; the bypass is real today. Address in the same plan-008 follow-up that aligns the skill-script.

- **[P2][advisory → human] `packages/api/workspace-files.ts:387-419`** (adversarial, conf 65).
  `handlePut` trusts the path string fully (only checks pinned-file class). U12's validator is the single point of enforcement; a future refactor regression silently lands in S3. Per institutional learning `inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`, accept the inlined-validator pattern but add a fixture-parity test as the drift detector — same allowlist regex / same NFKC behavior on both sides.

- **[P2][manual → downstream-resolver] `packages/workspace-defaults/files/MEMORY_GUIDE.md:71-75`** (agent-native, high confidence).
  This file is loaded into the system prompt every turn. The "When to use these vs `write_memory`" section currently implies a single fixed location (`memory/lessons.md / preferences.md / contacts.md`). Once U9 spawn ships, sub-agents reading it will call `write_memory("memory/lessons.md", ...)` and clobber the parent's root file — exactly the bug U12 was written to make fixable. Add a paragraph: "When you are a sub-agent rooted at `{folder}/`, prefix the path with your folder: `write_memory('{folder}/memory/lessons.md', ...)`. The path is from the agent root, not your sub-folder; passing just `'memory/lessons.md'` would write to the parent agent's notes."

- **[P2][manual → downstream-resolver] `packages/workspace-defaults/files/AGENTS.md:18`** (agent-native, medium confidence).
  Writable-folder map only documents the root case (`memory/             ← durable lessons, preferences, contacts (write_memory tool)`). Update legend or add a one-line note: "each sub-agent folder also gets its own `memory/` for its own `write_memory` calls — pass the full path from agent root."

- **[P2][advisory → human] `packages/agentcore-strands/agent-container/test_write_memory_tool.py`** (kieran-python, conf 70).
  18 in-method `from write_memory_tool import _validate_memory_path` lines hide the dependency. Hoist to module scope for `TestValidateMemoryPath`. The `TestWriteMemoryTool` per-method import is justified by its `del sys.modules` setUp; only the validator class needs cleanup.

- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/test_write_memory_tool.py:252-294`** (testing, conf 75).
  URL target captured in the urllib mock but never asserted. A regression that posts to the wrong endpoint passes silently.

- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:209-216`** (testing, conf 70).
  `_MCP_TENANT_ID`, `_MCP_AGENT_ID`, `THINKWORK_API_SECRET` fallback branches are popped to test the missing-config branch but never positively tested as fallbacks.

### P3

- **[P3][advisory → human] `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:52-61`** (kieran-python + maintainability, conf 35).
  `_BASENAME_ALTERNATION` constant + f-string regex is mild over-engineering for 3 hardcoded strings. Either inline `r"memory/(lessons|preferences|contacts)\.md$"` or commit to a real iterable allowlist. Doesn't sync with TS `AGENT_WRITABLE_MEMORY_BASENAMES` (parallel hardcoding) so the abstraction earns nothing.

- **[P3][advisory → human] validator shape divergence from U9** (maintainability, medium).
  `_validate_memory_path` and U9's `validate_path` share 4 invariants (None/empty, absolute, reserved-segment, depth-5) but no shared core. Plan justified the duplication. Extract `_validate_path_core` when a 3rd caller surfaces (recall_memory parity, skill-script alignment).

- **[P3][advisory → human] composition gap — pre-pollution by parent agent** (adversarial, conf 70).
  A parent agent can pre-write to `expenses/memory/lessons.md` before that sub-agent is spawned. Plan's Risks table covers sub-agent→parent confusion but not the inverse direction. Workaround: server-side handler could enforce that writes to `{folder}/memory/...` require the caller's `agentId` to match the rooted-at agent. Real concern only when sub-agent spawn becomes live (U9 follow-up).

- **[P3][advisory → human] `_validate_memory_path`** (security, conf 35).
  No max-length cap on path input. Multi-kB paths are accepted today; CPU-bounded by linear regex (not ReDoS), but a cheap `len(path) > 1024` guard would harden against future regex loosening.

- **[P3][advisory → human] `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:107-114`** (kieran-python, conf 45).
  Two near-duplicate dot-segment branches (`.. in segments`, `. in segments`) could collapse into a single tuple iteration. Stylistic; current form is acceptable.

- **[P3][advisory → human] `packages/agentcore-strands/agent-container/container-sources/write_memory_tool.py:90`** (kieran-python, conf 40).
  Validator silently strips surrounding whitespace — accept-after-repair is permissive for a security boundary. Either reject paths whose strip differs from the original, or add an explicit test that locks the silent-strip contract.

- **[P3][manual → downstream-resolver] Unicode bypass test parity** (security + adversarial, medium).
  Plan documents NFKC bypass cases. Autofix added fullwidth slash + fullwidth dot tests; remaining classes (zero-width space, RTL override, combining diacritics) should be parametrized in a follow-up to lock in regression-resistance.

### Pre-existing (out of scope)

- TS `MemoryBasename` doc comment in `packages/workspace-defaults/src/index.ts:48-49` ("Parameter is a basename enum, not a path — callers never construct paths") is now wrong post-U12. Low priority — no caller breaks. Update if a follow-up touches that file.
- `apps/admin/src/routes/.../defaults.tsx` and `.../$agentId_.workspace.tsx` reference the three `memory/*.md` template strings as defaults for new agents, not constraints. No work needed.

## Source PR-review run context

- Run artifact: `.context/compound-engineering/ce-code-review/20260425-da44a00f/`
- Per-reviewer JSON files: `correctness.json`, `testing.json`, `maintainability.json`, `project-standards.json`, `kieran-python.json`, `security.json`, `adversarial.json`
- Synthesis summary: `.context/compound-engineering/ce-code-review/20260425-da44a00f/_summary.md`
- HEAD at review time: `5c6f643` (autofix commit landed after).
- Verdict: Ready with fixes
