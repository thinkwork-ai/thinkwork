---
title: "refactor(strands): extract hard-coded system contracts into skill-catalog"
type: refactor
status: active
date: 2026-05-21
origin: docs/brainstorms/2026-05-12-agentskills-contract-and-portability-requirements.md
---

# refactor(strands): extract hard-coded system contracts into skill-catalog

## Overview

The Strands runtime currently inlines behavioral contracts — durable rules about how the agent should behave on a given turn — as Python string literals inside `server.py`. The Computer Thread Contract is a 60-line block at `packages/agentcore-strands/agent-container/container-sources/server.py:3097-3162` that compiles into the container image and can only be changed by editing Python, redeploying the container, and updating substring-pinned tests. The eval-mode runtime constraint and the runbook-execution preamble follow the same anti-pattern.

This plan extracts those contracts into proper Agent Skills under `packages/skill-catalog/`, gated by a new `activates_on:` frontmatter selector that the runtime evaluates per turn. Genuine runtime mechanics (data formatters for KB context, attachments, requester overlay, external task envelopes, runbook task lists) stay in code — they format per-turn data, not durable rules. The two-layer classifier from the 2026-05-12 agentskills contract brainstorm ("would I want this to travel with the agent when exported?") is the test: contracts pass, data formatters fail.

The plan also refreshes `packages/skill-catalog/artifacts/SKILL.md` to align with Anthropic's `web-artifacts-builder` skill shape and ports its "avoid AI slop" design-guideline language. The artifact runtime mechanics (TSX runtime, `preview_app`/`save_app` tools, iframe-isolated fragments, shadcn MCP) are not touched — those are deliberate ThinkWork choices that diverge from Anthropic's claude.ai HTML-bundle output model.

## Problem Frame

The Computer Thread Contract was the trigger: a user noticed an LLM citing "Call save_app only after the user asks to save or an active runbook phase requires persistence" as a fixed rule, traced it through `AGENTS.md`, then through the admin UI, then through workspace files, and ultimately to a Python string literal at `server.py:3140-3141`. Editing the rule required a container rebuild + redeploy + a test substring-pin update — for a sentence that is unambiguously workspace-shape content.

This is the entanglement the 2026-05-12 brainstorm named: agent-shaping behavior compiled into fleet-running code. The brainstorm scoped a read-only audit deliverable (Borrow C) but explicitly deferred both the audit and the migration to follow-up `/ce-plan` cycles (R13, AE4). The audit was never produced. This plan rolls the audit and the migration into one execution, narrowed per Eric's request to **instruction blocks only** — the per-turn data formatters and lookup-driven KB context are not in scope.

Three contracts qualify under the strict reading:

1. **Computer Thread Contract** (`server.py:3097-3162`) — primary motivation. ~60 lines of "do this not that" copy injected when `is_computer_thread_turn` is true. References `save_app`, `preview_app`, the shadcn MCP requirements, applet-build-in-parent-turn rules, and the "delegate cannot save" guardrail. The applet-build heuristic copy that the brainstorm called out separately lives inside this block, not in `_is_computer_applet_build_request` (which is a bool returning function — runtime mechanic, stays in code).

2. **Eval Runtime Constraints** (`server.py:2650-2665`) — ~15 lines of behavioral guidance injected when `eval_mode` is true. Tells the model to answer directly, refuse cross-tenant data requests, and avoid building artifacts during evaluation runs.

3. **Runbook Execution Contract** — the prose preamble at `runbook_context.py:41-49` ("A ThinkWork runbook is active. The runbook definition is the source of truth..."). The rest of `format_runbook_context` renders per-turn data (task list, phase metadata, skill snapshot, prior outputs) and stays in code. Eric noted runbooks are being deprecated, so this extraction is light — preserve the rule while it's still in use, but no need to invest deeply.

Three more candidates that fail the strict-scope test (data formatters with embedded one-line instructions) stay in code: `_format_message_attachments_preamble`, `format_external_task_context`, `format_workflow_skill_context`. Their instruction lines are short, tightly coupled to the data they describe, and would lose meaning if separated.

Pure data wrappers (`_format_requester_context_overlay`, KB context, Workspace Knowledge) are not in scope at all — no behavioral content to extract.

## Requirements Trace

- R1. The three named contracts (Computer Thread Contract, Eval Runtime Constraints, Runbook Execution Contract preamble) live as `SKILL.md` files under `packages/skill-catalog/` with skill-catalog frontmatter conventions, not as Python string literals in `server.py` / `runbook_context.py`.
- R2. A new `activates_on:` frontmatter field declares each contract's gating condition. The runtime evaluates it per turn against a `conditions` dict (`thread_mode`, `eval_mode`, `runbook_active`). Skills without `activates_on:` never load as system contracts — `activates_on:` is the discriminator.
- R3. A new `contract: system` frontmatter field distinguishes these from user-invocable skills so they do not appear in the AgentSkills progressive-disclosure surface (`<available_skills>` XML, `Skill` meta-tool listing).
- R4. The Computer Thread Contract preserves its two per-turn template variables (`thread_id`, `prompt`). The runtime substitutes `{{thread_id}}` / `{{prompt}}` in the skill body before appending. A `template_variables:` frontmatter field declares the variables the contract expects.
- R5. The system-contract loader is **pure**: given a catalog directory, a conditions dict, and a variables dict, it returns a list of rendered skill bodies. No S3, no HTTP, no per-turn filesystem walks outside the catalog directory.
- R6. The runtime calls the loader **exactly once per turn**, after `_build_system_prompt` runs and after data-shaped blocks (requester overlay, attachments, external task, workflow, runbook, KB) have been appended. Output order in the resolved system prompt remains identical to today's output order, so model behavior does not shift on extraction alone.
- R7. After extraction, `_computer_thread_contract` and `_eval_runtime_prompt` are deleted from `server.py`. The runbook-execution preamble lines are deleted from `runbook_context.py:41-49`; the rest of `format_runbook_context` keeps rendering data.
- R8. The two existing test substring pins (`test_server_chunk_streaming.py:345`, `:467`) are replaced with structural assertions — "Computer Thread Contract skill loaded for this turn" — plus one canonical-phrase smoke per contract (e.g., `"save_app"` for the Computer contract). Substring drift no longer churns tests on copy changes.
- R9. `packages/skill-catalog/artifacts/SKILL.md` is rewritten in the shape of Anthropic's `web-artifacts-builder` SKILL.md (concise frontmatter; numbered-step body; Design & Style Guidelines section; Quick Start subsections). The "avoid centered layouts, purple gradients, uniform rounded corners, Inter font" guidance is ported verbatim under a new Design & Style Guidelines section. The TSX runtime, `preview_app`/`save_app` tools, iframe fragment isolation, and shadcn MCP integration are **not** changed.

---

## Output Structure

```
packages/skill-catalog/
├── computer-thread-contract/
│   └── SKILL.md
├── eval-runtime-constraints/
│   └── SKILL.md
├── runbook-execution-contract/
│   └── SKILL.md
└── artifacts/
    └── SKILL.md            # rewritten in U6

packages/agentcore-strands/agent-container/container-sources/
└── system_contract_loader.py   # new: pure loader for system contracts

packages/agentcore-strands/agent-container/
└── test_system_contract_loader.py   # new: loader unit tests
```

No new directory hierarchy beyond the three new skill folders and one new loader module. Per-unit `**Files:**` sections remain authoritative.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Frontmatter shape for system contracts:**

```yaml
---
name: computer-thread-contract
description: Behavioral contract for agent turns running inside ThinkWork Computer
license: Proprietary
contract: system               # marks this as a system contract, not user-invocable
activates_on:
  thread_mode: computer        # all keys must match the runtime's conditions dict
template_variables:            # optional; runtime substitutes {{var}} in body
  - thread_id
  - prompt
---

## Computer Thread Contract
[body, with {{thread_id}} and {{prompt}} substitution points]
```

**Runtime flow per turn:**

```
1. _build_system_prompt loads workspace files + system canonical files (unchanged)
2. Data-shaped blocks append in their existing order (unchanged):
   requester overlay → eval prompt [DELETED in U3] → attachments → external →
   workflow → runbook → KB context
3. NEW: load_system_contracts(
        catalog_dir = packages/skill-catalog,    # available in the container image
        conditions = {
            "thread_mode": "computer" if is_computer_thread_turn else "default",
            "eval_mode": eval_mode,
            "runbook_active": bool(runbook_context),
        },
        variables = { "thread_id": ticket_id, "prompt": message },
   )
   returns [rendered_body, ...] for every catalog SKILL.md whose
   `contract: system` AND `activates_on` matches conditions.
4. Append each rendered body to system_prompt with "\n\n---\n\n" separators.
```

**Loader behavior (directional pseudo-code):**

```
def load_system_contracts(catalog_dir, conditions, variables):
    bodies = []
    for skill_md in walk(catalog_dir, "*/SKILL.md"):
        parsed = parse_skill_md(read(skill_md))
        if parsed.frontmatter.get("contract") != "system": continue
        activates_on = parsed.frontmatter.get("activates_on") or {}
        if not all(conditions.get(k) == v for k, v in activates_on.items()): continue
        body = parsed.body
        for var in parsed.frontmatter.get("template_variables") or []:
            body = body.replace("{{"+var+"}}", str(variables.get(var, "")))
        bodies.append(body)
    return sorted(bodies)  # sort by slug for deterministic ordering
```

The loader is sibling to `skill_resolver.py`, not a replacement. `skill_resolver` is slug-pull (caller asks for `slug=X`); `system_contract_loader` is condition-push (loader returns every match). They share `skill_md_parser` for frontmatter parsing but otherwise do not overlap.

---

## Implementation Units

### U1. System contract loader + frontmatter conventions

**Goal:** Introduce the `system_contract_loader.py` module + the `activates_on`/`contract`/`template_variables` frontmatter vocabulary. No skill files migrated yet — this unit lands the plumbing inert per the project's `feedback_ship_inert_pattern` convention.

**Requirements:** R2, R3, R4, R5

**Dependencies:** none

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/system_contract_loader.py` (create)
- `packages/agentcore-strands/agent-container/test_system_contract_loader.py` (create)

**Approach:**
- Pure function `load_system_contracts(catalog_dir: str, conditions: dict, variables: dict) -> list[str]`.
- Walks `<catalog_dir>/*/SKILL.md`, parses each via `skill_md_parser.parse_skill_md_string`, filters by `frontmatter.contract == "system"`, evaluates `activates_on` against `conditions` (every key-value pair must match), substitutes `{{var}}` for each declared `template_variables` entry.
- Returns rendered bodies sorted by skill slug so order is deterministic across containers.
- Skills with malformed frontmatter log a warning and skip — same fall-through pattern as `skill_resolver.py:300-305`. A broken system contract should not abort the turn.
- Unknown `activates_on` keys do not match (missing key in conditions ≠ "always match"). A typo in a contract should fail closed.
- No filesystem walking outside `catalog_dir`. The catalog directory is bundled into the container image at build time (the skill files ship with the container).

**Patterns to follow:**
- `skill_resolver.py:206-229` — the `_is_usable_local` shape (required frontmatter fields, fall-through with reason logged).
- `skill_md_parser.py:163` `parse_skill_md_string` — the existing frontmatter parser.

**Test scenarios:**
- Happy path: a catalog with one `contract: system` skill whose `activates_on: { thread_mode: computer }` matches conditions returns that skill's body.
- Happy path: a catalog with two matching skills returns both bodies, sorted by slug.
- Negative match: a skill whose `activates_on` includes a key the conditions dict does not contain returns no body (fail-closed).
- Negative match: conditions match for some keys but not all → skill does not load (every key-value pair must match).
- Discrimination: a skill without `contract: system` is not loaded even if `activates_on` matches.
- Template substitution: a skill with `template_variables: [thread_id]` and `{{thread_id}}` in body substitutes correctly; a variable not provided in the `variables` dict substitutes to empty string.
- Robustness: a `SKILL.md` with malformed frontmatter logs a warning and is skipped; other skills still load.
- Determinism: re-running the loader with the same inputs returns bodies in the same order.

**Verification:** `uv run pytest packages/agentcore-strands/agent-container/test_system_contract_loader.py` passes; the loader is callable but no caller wires it in yet.

---

### U2. Extract Computer Thread Contract to skill

**Goal:** Move the 60-line Python string at `server.py:3097-3162` into `packages/skill-catalog/computer-thread-contract/SKILL.md` and wire the runtime to read it via the loader.

**Requirements:** R1, R6, R8 (Computer contract portion)

**Dependencies:** U1

**Files:**
- `packages/skill-catalog/computer-thread-contract/SKILL.md` (create)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify: replace `_computer_thread_contract` call with loader call; preserve the conditional gate)
- `packages/agentcore-strands/agent-container/test_server_chunk_streaming.py` (modify: replace substring pins with structural + smoke assertions)

**Approach:**
- The new `SKILL.md` body is a verbatim port of the current contract text from `server.py:3097-3162`, with `{{thread_id}}` and `{{prompt}}` substitution points where the Python conditional appends were doing `f"Current threadId: {thread_id}"`. The current trailing lines `- Current threadId: {thread_id}` / `- Current prompt: {prompt}` become template-substituted lines in the SKILL.md body.
- Frontmatter:
  ```yaml
  name: computer-thread-contract
  description: Behavioral contract for agent turns running inside ThinkWork Computer
  license: Proprietary
  contract: system
  activates_on:
    thread_mode: computer
  template_variables:
    - thread_id
    - prompt
  ```
- `server.py:2930-2934` changes from the `if is_computer_thread_turn:` Python gate calling `_computer_thread_contract(...)` to calling the loader with `conditions = {"thread_mode": "computer" if is_computer_thread_turn else "default"}` and `variables = {"thread_id": ticket_id, "prompt": message}`. The conditional logic moves from Python to frontmatter (`activates_on: thread_mode: computer`).
- The loader is called once for ALL contracts (U3 + U4 will add more conditions), but in this unit only the Computer contract has been migrated, so the loader call's `conditions` dict needs to include `eval_mode` and `runbook_active` slots even though they're unused this unit — to avoid churn in U3/U4.
- `_computer_thread_contract` function is NOT deleted yet — that is U5. Leaving it in place during U2 lets reviewers diff the new skill body against the old Python literal.

**Patterns to follow:**
- Anthropic's `skills/web-artifacts-builder/SKILL.md` shape — concise frontmatter, numbered/sectioned body, no superfluous prose.
- Existing skill bodies in `packages/skill-catalog/` for ThinkWork-conventional frontmatter fields (`license`, `name`, `description`).

**Test scenarios:**
- Covers R8. The two existing substring pins at `test_server_chunk_streaming.py:345` (negative: contract absent on non-Computer turn) and `:467` (positive: contract present on Computer turn) are replaced with:
  - Negative: `assert "## Computer Thread Contract" not in captured["system_prompt"]` on a non-Computer turn (kept — single line, no churn cost).
  - Positive smoke: `assert "save_app" in captured["system_prompt"]` AND `assert "## Computer Thread Contract" in captured["system_prompt"]` on a Computer turn — proves the skill loaded and one canonical phrase survived rendering. The 10+ substring pins at lines 468-487 collapse into this single smoke assertion.
- New: template variable substitution — given `thread_id="t-1"` and `prompt="hello"`, the rendered system prompt contains `"Current threadId: t-1"` and `"Current prompt: hello"`.
- New: changing the SKILL.md body to add a new phrase (in a fixture) shows up in the rendered prompt without server.py changes — proves the runtime no longer hardcodes the copy.

**Verification:** `uv run pytest packages/agentcore-strands/agent-container/test_server_chunk_streaming.py` passes; manual diff of resolved system prompt before/after extraction shows no semantic drift (whitespace differences acceptable).

---

### U3. Extract Eval Runtime Constraints to skill

**Goal:** Move `_eval_runtime_prompt` body (server.py:2650-2665) into `packages/skill-catalog/eval-runtime-constraints/SKILL.md`. Wire via the loader.

**Requirements:** R1, R6

**Dependencies:** U1, U2 (U2 establishes the loader call site that U3 extends)

**Files:**
- `packages/skill-catalog/eval-runtime-constraints/SKILL.md` (create)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify: stop calling `_eval_runtime_prompt`; the loader's `conditions = {"eval_mode": eval_mode, ...}` already covers it)

**Approach:**
- Frontmatter:
  ```yaml
  name: eval-runtime-constraints
  description: Behavioral constraints active during RedTeam evaluation runs
  license: Proprietary
  contract: system
  activates_on:
    eval_mode: true
  template_variables:
    - tool_guidance      # the conditional "tools available" / "tools disabled" preamble line
  ```
- The current Python function builds `tool_guidance` from `eval_tools_enabled` (line 2651-2655). That two-branch string becomes a template variable supplied by the runtime: the runtime computes the right preamble and passes it in `variables = { "tool_guidance": ..., ... }`.
- The SKILL.md body is the verbatim text from server.py:2657-2664 with `{{tool_guidance}}` at the start.
- `_eval_runtime_prompt` Python function stays in place; U5 deletes it.

**Test scenarios:**
- Covers R1. On a turn with `eval_mode=True`, the resolved system prompt contains `## Evaluation Runtime Constraints` and `"RedTeam evaluation"`.
- On a turn with `eval_mode=False`, the constraints block is absent.
- The `tool_guidance` template variable substitutes correctly for both `eval_tools_enabled=True` and `eval_tools_enabled=False`.
- Negative: an eval-mode turn without the loader still produces a system prompt (no crash) — fail-closed loader behavior.

**Verification:** Existing eval-mode integration tests in `test_server_chunk_streaming.py` continue to pass.

---

### U4. Extract Runbook Execution preamble to skill

**Goal:** Move the prose preamble lines at `runbook_context.py:41-49` into `packages/skill-catalog/runbook-execution-contract/SKILL.md`. The per-turn data rendering (task list, phase metadata, skill snapshot, prior outputs, queue snapshot) stays in `runbook_context.py`.

**Requirements:** R1, R6, R7 (runbook preamble portion)

**Dependencies:** U1, U2

**Files:**
- `packages/skill-catalog/runbook-execution-contract/SKILL.md` (create)
- `packages/agentcore-strands/agent-container/container-sources/runbook_context.py` (modify: delete lines 41-49; `format_runbook_context` returns the data-only portion of the block)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify: loader's `conditions` dict adds `runbook_active: bool(runbook_context)`)

**Approach:**
- Frontmatter:
  ```yaml
  name: runbook-execution-contract
  description: Contract for agent turns running a ThinkWork runbook task
  license: Proprietary
  contract: system
  activates_on:
    runbook_active: true
  ```
- No template variables — the preamble is purely durable rule text. The per-turn runbook data (runbook slug, run ID, current task, capability roles) continues to render via `format_runbook_context` and is appended separately, **immediately following** the contract skill so the two read as one section.
- Output order in the resolved system prompt: contract first (loader output), then data block (runbook_context output) — matches today's order where the preamble precedes the data within the same block.
- Eric noted runbooks are being deprecated. This extraction is light: preserve the rule while runbooks are in use, but invest minimally — no separate references/, no asset templates.

**Test scenarios:**
- Existing `runbook_context.py` tests (if any) continue to pass; the data renderer's output no longer includes lines 41-49.
- New: on a turn with `runbook_context` present, the resolved system prompt contains both `## Runbook Execution Context` (from the data renderer's surviving header) and the preamble text (from the loaded skill).
- Order: the preamble appears before the data block when both are present.
- On a turn without `runbook_context`, neither the preamble nor the data block appears.

**Verification:** `uv run pytest packages/agentcore-strands/agent-container/test_runbook_*.py` passes; manual review confirms the data renderer no longer carries durable-rule prose.

---

### U5. Delete now-unused Python helpers

**Goal:** Remove `_computer_thread_contract` (server.py:3097-3162) and `_eval_runtime_prompt` (server.py:2650-2665) from `server.py`. Clean up imports and any helper tests that targeted those Python functions directly.

**Requirements:** R7

**Dependencies:** U2, U3 (callers replaced first)

**Files:**
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify: delete two functions + the no-longer-needed conditional appends at lines 2898-2899, 2930-2934 — the loader call replaces both)
- `packages/agentcore-strands/agent-container/test_server_chunk_streaming.py` (modify if any test imports the deleted functions directly)

**Approach:**
- This is the cleanup unit. U2 and U3 left the Python helpers in place to keep the diff legible. With both callers migrated and tests green, the helpers become dead code and should be deleted in a focused commit.
- Deleted lines: server.py:2650-2665 (`_eval_runtime_prompt`), server.py:3097-3162 (`_computer_thread_contract`), server.py:2898-2899 (`if eval_mode:` block), server.py:2930-2934 (`if is_computer_thread_turn:` block calling the deleted helper).
- The loader call (added in U2) replaces both appends.
- Search for any test imports of `_computer_thread_contract` or `_eval_runtime_prompt` and migrate to the loader-based test pattern.

**Test scenarios:**
- All previously-passing tests continue to pass.
- No new test scenarios — this is dead-code deletion.

**Test expectation: none -- this is pure dead-code removal; behavior coverage lives in U2-U4.**

**Verification:** Full Strands test suite passes (`uv run pytest packages/agentcore-strands/agent-container/`); `grep -n "_computer_thread_contract\|_eval_runtime_prompt" packages/agentcore-strands/` returns no matches.

---

### U6. Refresh artifacts skill from Anthropic's web-artifacts-builder shape

**Goal:** Rewrite `packages/skill-catalog/artifacts/SKILL.md` to align with Anthropic's `web-artifacts-builder` SKILL.md shape and port the "avoid AI slop" design-guideline language. **Do not** change the ThinkWork artifact runtime (TSX, iframe fragments, `preview_app`/`save_app`, shadcn MCP).

**Requirements:** R9

**Dependencies:** none (orthogonal to U1-U5)

**Files:**
- `packages/skill-catalog/artifacts/SKILL.md` (modify)

**Approach:**
- Reshape frontmatter to be lean (name, description, license) — keep ThinkWork-specific fields (`execution: script`, `is_default: true`, `triggers`, `scripts`) since they drive runtime registration.
- Body sections to add or restructure, following Anthropic's order:
  1. One-paragraph "When this fires" / "What this builds" preamble.
  2. **Stack** line (state explicitly: TSX + shadcn-only validator + iframe-isolated fragment substrate + `preview_app`/`save_app` tools — not React + Parcel + html-inline like Anthropic's).
  3. **Design & Style Guidelines** section — port the AI slop guidance verbatim: "avoid excessive centered layouts, purple gradients, uniform rounded corners, and Inter font". This is new content we do not have today.
  4. **Quick Start** subsections walking through: produce TSX → call `preview_app` → call `save_app` only when the user/runbook asks. Mirrors Anthropic's three-step structure but with ThinkWork's tool names.
  5. **Reference** section linking to the shadcn MCP component-source tool and the project's TSX validator reference.
- Do **not** port `init-artifact.sh`, `bundle-artifact.sh`, or `shadcn-components.tar.gz` — those target Anthropic's static-HTML output model, which is not ours. The orthogonal scope-bundle to refresh starter materials is a separate follow-up.
- The save-confirmation rule that was in the deleted Computer Thread Contract now belongs in the new `computer-thread-contract` skill (U2), not duplicated here. Artifacts SKILL.md focuses on **how to build**, the Computer contract handles **when to save**.

**Test scenarios:**
- No new tests — the skill body is operator-facing content. Existing artifacts-related integration tests (preview_app validator, save_app persistence) continue to pass unchanged.
- Manual review: skill body reads in the shape an operator would expect from a SKILL.md following Anthropic's example, with ThinkWork-specific tool names.

**Test expectation: none -- pure content refresh; the runtime is not touched, so behavior coverage is unchanged.**

**Verification:** `pnpm --filter @thinkwork/skill-catalog test` (if any catalog-level tests exist) passes; a human review confirms the new body is concise, follows the Anthropic shape, and ports the design-guideline language without conflating it with runtime mechanics.

---

## Key Technical Decisions

- **`activates_on:` as the conditional gate, not Python if-statements.** Per Eric's call-out answer, the cleanest mental model is: skills declare their own activation conditions in frontmatter, and the runtime evaluates the dict. This makes the Computer Thread Contract a self-contained artifact an operator can read end-to-end without reading Python. Alternative considered: keep the Python gate and just load the skill body from disk. Rejected because the gate logic is part of the contract — moving the text but leaving the activation rule in Python only solves half the entanglement.
- **`contract: system` field discriminates from user-invocable skills.** The AgentSkills progressive-disclosure surface (`<available_skills>` XML, `Skill` meta-tool) should not list `computer-thread-contract` as something the model can invoke — it is always-on when its conditions match, not callable. A frontmatter discriminator is the simplest filter; the alternative (separate catalog directory) introduces a second package-layout concept.
- **System contracts ship in the container image, not via S3 sync.** The catalog directory `packages/skill-catalog/` is already bundled into the container image at build time (the loader reads from `/var/task/skill-catalog/` or equivalent). Tenants do not author or override system contracts — these are platform contracts, fleet-layer per the 2026-05-12 brainstorm's two-layer model. Future agent-layer skill overrides go through the existing workspace-resolver path.
- **Strict scope: data formatters stay in code.** `format_external_task_context`, `format_workflow_skill_context`, `_format_message_attachments_preamble`, `_format_requester_context_overlay`, KB context, and Workspace Knowledge all carry per-turn data, not durable rules. The two-layer classifier "would I want this to travel with the agent when exported?" returns no for all of them. Per Eric's strict-reading call-out.
- **Runbook preamble extracts; runbook data renderer stays.** The preamble at `runbook_context.py:41-49` is durable rule text ("A ThinkWork runbook is active. The runbook definition is the source of truth..."). Lines 50+ are per-turn data. The split mirrors the strict scope rule — durable rules extract, per-turn data stays.
- **Template variables stay minimal (Mustache-style).** The Computer contract needs `thread_id` and `prompt`; the eval contract needs `tool_guidance`. Loader does naive `{{var}}` string replacement, no expression evaluation, no conditional sections. If a future contract needs richer templating, that decision is downstream.
- **Tests: structural + canonical-phrase smoke.** Per Eric's call-out answer. The 10+ substring pins in `test_server_chunk_streaming.py:467-487` collapse into one smoke assertion per contract. Edits to skill copy no longer churn tests; only structural regressions (skill failed to load on Computer turn) fail tests.
- **Refresh `artifacts/` to Anthropic shape, port design language, don't port runtime.** Per Eric's call-out answer. Anthropic's `web-artifacts-builder` targets claude.ai's static-HTML artifact format (Parcel + html-inline). Ours targets a persisted TSX-runtime applet model. The runtime mechanics are not swap-compatible; the SKILL.md shape and the design-guideline language are.

---

## Scope Boundaries

### In scope

- Three contract extractions: Computer Thread Contract, Eval Runtime Constraints, Runbook Execution preamble.
- New `system_contract_loader.py` module + frontmatter vocabulary (`activates_on`, `contract: system`, `template_variables`).
- Runtime wiring in `server.py` (one loader call replacing two conditional appends).
- Deletion of the now-unused Python helpers.
- Test migration from substring pins to structural + smoke assertions.
- Artifacts SKILL.md refresh: shape alignment + design-guideline language port.

### Deferred to Follow-Up Work

- **Borrow C audit deliverable proper.** This plan covers instruction blocks. The 2026-05-12 brainstorm R10 enumerates other code-resident agent-layer behaviors (per-agent MCP server config, skill-resolver precedence, memory engine selection, workspace bootstrap sequence, canonical-file auto-load list, Nova Act key resolution, `has_workspace_map` mode trigger logic). Those each need their own audit + migration plan.
- **Anthropic web-artifacts-builder scripts/assets port.** `init-artifact.sh` + `bundle-artifact.sh` + `shadcn-components.tar.gz` target Anthropic's static-HTML output and would conflict with the TSX runtime. A separate plan can do a side-by-side and decide what (if anything) to port as starter material.
- **Tenant-overridable system contracts.** Today system contracts ship in the container image only. A future plan could extend the loader to also walk the agent workspace (`workspace/system-contracts/`) so tenants can override platform contracts. Out of scope here — the v1 enterprise-scale concern is consistent platform behavior, not per-tenant rule customization.
- **Runbook system retirement.** Eric noted runbooks are being deprecated. The runbook-execution-contract skill ships as part of this plan to preserve current behavior, but is a candidate for deletion when the runbook system itself is retired.

### Outside this product's identity

- Treating data formatters (external task envelope, workflow form JSON, attachments file list, requester overlay, KB results) as skills. They format per-turn data, not durable rules. The brainstorm's two-layer classifier fails them; they remain runtime mechanics.
- A general-purpose templating language in skill bodies. Naive `{{var}}` substitution is sufficient for the three contracts in scope. Adding expression evaluation, conditional sections, or partials would be inventing complexity for hypothetical future requirements.
- Operator-editable system contracts via the admin UI. System contracts are platform-layer artifacts edited via PRs to this repo, not via tenant UI. Per the two-layer model, only agent-layer files are tenant-authored.

---

## Risk Analysis & Mitigation

- **Risk: subtle semantic drift in extracted text.** Copy-pasting a 60-line Python string into a Markdown file can lose meaningful whitespace, list-marker indentation, or fenced-block fidelity, and the model can behave differently in production even if tests pass.
  - **Mitigation:** U2's verification step requires a manual diff of the resolved system prompt before/after extraction. The diff must show whitespace-only differences (no missing or reordered lines). Run a parallel `_call_strands_agent` invocation against both old-path and new-path on a Computer turn fixture and compare the resolved `system_prompt` strings character-by-character (modulo trailing whitespace).
- **Risk: loader breaks on a malformed SKILL.md and aborts the turn.** A typo in a contract's frontmatter should not take down all Computer turns.
  - **Mitigation:** Loader fails closed per skill (log warning, skip), same pattern as `skill_resolver.py:300-305`. Test scenario in U1 verifies a malformed skill is skipped, other skills still load.
- **Risk: deploy mismatch — new container has loader code but old skill files baked in, or vice versa.** Could produce missing system prompt sections or stale rules.
  - **Mitigation:** The container Dockerfile copies BOTH `packages/skill-catalog/` and the loader module in a single COPY layer. A single PR to `main` deploys both atomically. There is no per-component versioning; the loader and the skills ship together.
- **Risk: catalog directory path differs between local dev (`packages/skill-catalog/`) and container image (`/var/task/skill-catalog/` or similar).** Loader hardcoded to one path will fail in the other.
  - **Mitigation:** U1 reads catalog directory from an env var (`SKILL_CATALOG_DIR`) with a default that matches the container layout. Local dev sets the env var to the source-tree path. The existing `SYSTEM_WORKSPACE_DIR` pattern at `server.py:480` is the precedent.
- **Risk: Computer Thread Contract evolves in production and someone edits the skill file directly on a deployed container.** Edits would be lost on next deploy.
  - **Mitigation:** Out of scope per the "system contracts ship in container, not S3" decision. The container filesystem is immutable from the operator's perspective; edits go through PRs. This matches the existing behavior of `packages/workspace-defaults/files/`.

---

## Dependencies / Prerequisites

- The existing `skill_md_parser.py` parser must handle the new `activates_on`, `contract`, and `template_variables` fields without rejecting them. Verified: the parser stores frontmatter as a dict and does not whitelist field names. No changes needed.
- The container build process (Docker COPY for `packages/skill-catalog/`) must include the three new skill directories. Verified by inspection: the existing COPY layer copies the whole skill-catalog package; new subdirectories ship automatically.
- The catalog directory must be readable at runtime from `system_contract_loader.load_system_contracts`. The existing `_dw_platform_manifest` build at `server.py:781-805` already reads `SKILL.md` files from the same catalog at boot — proves the path is accessible.

---

## Verification Strategy

- Per-unit: `uv run pytest` against the affected test files. U1 has dedicated loader tests; U2/U3/U4 update `test_server_chunk_streaming.py`; U5 runs the full suite.
- End-to-end before merging U5: dispatch a known Computer turn (e.g., the `applet-build-request` fixture) against the new path and confirm the resolved system prompt contains all canonical phrases from the old contract. Capture before/after `captured["system_prompt"]` strings and diff.
- After deploy to dev: run an actual Computer turn through the admin UI and verify the agent's behavior on a save-flow prompt matches pre-extraction behavior. Per `feedback_validate_locally_before_push`, Eric validates the rendered UI behavior in his primary checkout before any PR is opened.
- Smoke-test post-deploy: trigger an eval-mode run + a runbook turn + a Computer turn and confirm all three contracts activate independently and correctly.

---

## Anti-Goals

- **Do not** rewrite the contracts during extraction. The diff for U2 should be "Python string → Markdown skill" with semantically identical content. Copy improvements are a follow-up after extraction is stable.
- **Do not** add new contracts during this plan. Resist the urge to "while we're here" add a SOUL.md-like contract or a new memory-policy contract. The plan extracts three existing contracts; new contracts go in follow-up plans.
- **Do not** change the artifact runtime in U6. Reshape SKILL.md content; do not touch TSX validator, `preview_app`/`save_app`, iframe fragment isolation, or shadcn MCP integration.
- **Do not** propose an admin UI for editing system contracts. Per the two-layer model and the `feedback_dont_overgate_baseline_agent_capability` memory, system contracts are platform-layer artifacts edited via PRs. Adding admin-UI editing on top would re-entangle agent-layer and fleet-layer concerns.
