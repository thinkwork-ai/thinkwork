---
name: 2026-05-15-001-feat-activate-finance-skills-on-dev-plan
title: "feat: activate finance skills on dev"
type: feat
created: 2026-05-15
status: active
origin: docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md
origin-brainstorm: docs/brainstorms/2026-05-14-finance-analysis-pilot-requirements.md
---

# feat: activate finance skills on dev

## Summary

The finance-analysis pilot (see origin: `docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md`) shipped all 9 implementation units, but during e2e the agent never invoked any of the three Anthropic-derived finance skills (`finance-3-statement-model`, `finance-audit-xls`, `finance-statement-analysis`). It read attached `.xlsx` files via the built-in `file_read` MCP tool and produced a freeform analysis — proving file ingestion, but **not** proving that the skills lift works. The whole point of the pilot was to validate that we can borrow Anthropic-authored skills and have them fire in our runtime.

This plan does the smallest amount of work that proves the lift: install the catalog into the default Computer agent's workspace on dev, then run a fresh chat thread that demonstrates the agent invoking a finance skill on an attached spreadsheet. The skill content and runtime wiring already exist; this is an operator-side activation + verification, not a code feature.

The Skill meta-tool wire-up (U4 of the pilot plan, currently inert in `server.py`) is **deferred** — the Strands SDK's built-in `AgentSkills` plugin (already wired at `packages/agentcore-strands/agent-container/container-sources/server.py:2025-2043`) handles discovery + on-demand SKILL.md loading for context-execution skills, which is what all three finance skills are. The meta-tool only becomes load-bearing for **script**-execution skills; until we ship one, the meta-tool wire-up is over-scoped for this plan.

---

## Problem Frame

After the e2e session against `~/Desktop/docs/General-Ledger.xlsx`:

- `SELECT FROM agent_skills WHERE skill_id ILIKE 'finance%'` on dev → **0 rows**.
- `s3://thinkwork-dev-storage/tenants/sleek-squirrel-230/agents/fleet-caterpillar-456/workspace/skills/` → only `artifact-builder/` and `.gitkeep`.
- The agent's turn `usage.tool_invocations` carried only `file_read`. No `skills` invocation, no skill name in any input_preview.
- The operator install script `packages/skill-catalog/scripts/install-finance-pilot.ts` exists and has been on `origin/main` since commit `ab3c4b40` — but no one has ever run it against dev.

The script is a thin wrapper around `POST /api/workspaces/files` (`packages/api/workspace-files.ts`). On each PUT it triggers `deriveAgentSkills` (`packages/api/src/lib/derive-agent-skills.ts`), which seeds `agent_skills` rows from the composed AGENTS.md routing. With zero PUTs ever made for the finance skills, `agent_skills` was empty for finance, the Strands runtime resolved a finance-less `skills_config`, the workspace `/tmp/workspace/skills/` tree never materialized finance SKILL.md, and the AgentSkills plugin's `<available_skills>` XML never advertised them to the LLM.

The runtime side is already correct: `register_skill_tools` (`packages/agentcore-strands/agent-container/container-sources/skill_runner.py:130-138`) populates `skill_metadata` for **all** discovered SKILL.md — context and script — and the AgentSkills plugin reads `skill_meta.values()` (`server.py:2032-2038`) regardless of execution kind. The catalog just has to actually reach the workspace.

---

## Requirements Trace

Carried forward from origin pilot plan (`docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md`):

- **R-A1** (origin acceptance criterion 1): A fresh chat thread on Marco with an attached `.xlsx` invokes one of the three finance skills. (see origin §Acceptance)
- **R-A2** (origin acceptance criterion 2): The skill invocation shows up in `usage.tool_invocations` on the turn record, surfacing automatically in admin Thread Detail's expanded execution timeline. (see origin §U9)
- **R-A3** (origin acceptance criterion 3): `agent_skills` table has finance-* rows attached to Marco on dev. (see origin §U7)
- **R-A4** (origin acceptance criterion 4): Marco's S3 workspace contains finance SKILL.md files materialized. (see origin §U7)

New for this plan:

- **R-N1**: AGENTS.md on Marco includes routing prose that lets the model recognize the finance skills are available for spreadsheet-shaped requests. The install script doesn't currently edit AGENTS.md; the agent depends on the AgentSkills `<available_skills>` injection alone. If e2e shows the model isn't reaching for the skill, this requirement upgrades to a hard ship-blocker.

Deferred from origin (intentionally out of scope here):

- **U4 Skill meta-tool wire-up** (origin §U4): not needed for context-execution skills. Re-open when we ship the first script-execution skill or want to enforce session-allowlist intersection beyond what AgentSkills' built-in `skills` tool offers.
- **`skill.activated` audit emit** (origin §U6 events): without the meta-tool wired, the audit hook doesn't fire. AgentSkills' built-in `skills` tool calls show up in `usage.tool_invocations` (which is enough for R-A2). The audit emit is a follow-up tied to U4.

---

## High-Level Technical Design

```
operator                            dev stack
   │                                   │
   │  pnpm tsx install-finance-pilot.ts \
   │    --api-url=…  --token=…  --agent-id=<marco>
   │                                   │
   │           POST /api/workspaces/files (×3 SKILL.md + READMEs)
   ├──────────────────────────────────►│
   │                                   │
   │                                   ├─► workspace-files.ts handler
   │                                   │        │
   │                                   │        ├─► S3 PUT per file
   │                                   │        │     (tenants/.../agents/<marco>/
   │                                   │        │      workspace/skills/<slug>/...)
   │                                   │        │
   │                                   │        └─► deriveAgentSkills(agentId)
   │                                   │                │
   │                                   │                └─► UPSERT agent_skills rows
   │
   │  user opens computer.thinkwork.ai/new, attaches General-Ledger.xlsx,
   │  asks "what stands out in this financial statement?"
   │                                   │
   │                                   ├─► API /threads + /messages
   │                                   │
   │                                   ├─► agentcore-admin Lambda → AgentCore runtime
   │                                   │        │
   │                                   │        ├─► resolveAgentRuntimeConfig
   │                                   │        │     → skills_config includes finance-*
   │                                   │        │
   │                                   │        └─► Strands container boot
   │                                   │              ├─► register_skill_tools materializes
   │                                   │              │     finance SKILL.md to /tmp/workspace/
   │                                   │              ├─► AgentSkills plugin injects
   │                                   │              │     <available_skills> XML in prompt
   │                                   │              └─► LLM decides to call `skills(name=…)`
   │                                   │                    ↓
   │                                   │              tool_invocations records the call
   │                                   │
   │                                   └─► turn row hits Postgres; admin Thread Detail
   │                                       Activity timeline shows the `skills` invocation
   ▼
   admin Thread Detail (CHAT-NNN)
   ├─ User: "what stands out in this financial statement?"
   ├─ Thinking [expand]
   │     ├─ file_read /tmp/turn-…/General-Ledger.xlsx
   │     └─ skills    finance-statement-analysis   ← R-A1, R-A2
   └─ Computer: "Here's the analysis…"
```

*Directional guidance for review, not implementation specification. The arrows above call out the existing wiring this plan exercises rather than new code paths.*

---

## Key Technical Decisions

**Use the existing operator install script as-is.** The script is committed (`packages/skill-catalog/scripts/install-finance-pilot.ts`), idempotent on re-run (PUTs overwrite), and known to drive `deriveAgentSkills` end-to-end. No script modifications are part of this plan.

**Install against Marco, not a fresh test agent.** Marco is the default Computer agent on the only environment (`computer.thinkwork.ai`), already wired into the empty-composer attach flow that shipped in #1244, and is the surface the user is actually evaluating. A purpose-built test agent would prove less.

**Skip the Skill meta-tool wire-up.** AgentSkills' built-in `skills` tool already loads SKILL.md on demand for context-execution skills. Wiring `build_skill_meta_tool` from `skill_meta_tool.py:359` would overlap with AgentSkills' invocation surface (see the module docstring at lines 17-27 of that file — the design intent is to *replace* AgentSkills' `skills` tool, not run alongside it). That replacement is meaningful for script-execution skills (allowlist intersection, sandboxing, session pool, audit emit) — for context-only skills it's pure refactor with no behavior change. Defer until a script-execution skill makes it load-bearing.

**Edit AGENTS.md only if observation forces it.** AgentSkills injects `<available_skills>` XML into the system prompt unconditionally. That advertises the three finance skills without any AGENTS.md edit. Whether the LLM **chooses** to invoke them on a spreadsheet prompt is empirical — the right move is to install, observe, and only add AGENTS.md routing if the skill isn't reached. Don't write speculative prose.

---

## Implementation Units

### U1. Install finance pilot into Marco's workspace on dev

**Goal:** Run the existing operator install script against dev, targeting Marco. All three finance skill bundles (SKILL.md + README + LICENSE-NOTES, plus any `references/` files) land in S3 at `tenants/sleek-squirrel-230/agents/fleet-caterpillar-456/workspace/skills/<slug>/`, and `agent_skills` rows seed for each.

**Requirements:** R-A3, R-A4.

**Dependencies:** none — origin pilot's U5 (skill bundles) and U7 (install script) already shipped on `origin/main`.

**Files:** none modified.

**Approach:**

- Obtain a Cognito ID token for an admin user on dev. Two paths: (a) `thinkwork login -s dev` then read `~/.thinkwork/config.json`, or (b) capture from the admin SPA dev tools after sign-in. Either is fine — the script's `--token` is a Bearer JWT.
- Identify the dev API Gateway base URL (HTTP API, not AppSync). Available via `thinkwork me -s dev` or the admin SPA's `VITE_API_URL`.
- Run:
  ```
  pnpm tsx packages/skill-catalog/scripts/install-finance-pilot.ts \
    --api-url=<https://...execute-api.us-east-1.amazonaws.com> \
    --token=<id_token> \
    --agent-id=c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c
  ```
- Verify with a DB query against the dev RDS instance:
  ```sql
  SELECT skill_id, agent_id, enabled
    FROM agent_skills
    WHERE skill_id LIKE 'finance%';
  ```
  Expect three rows, all `enabled = true`, all pinned to Marco's UUID.
- Verify S3:
  ```
  aws s3 ls --recursive \
    s3://thinkwork-dev-storage/tenants/sleek-squirrel-230/agents/fleet-caterpillar-456/workspace/skills/
  ```
  Expect `finance-3-statement-model/SKILL.md`, `finance-audit-xls/SKILL.md`, `finance-statement-analysis/SKILL.md` plus their READMEs and LICENSE-NOTES.

**Patterns to follow:** the install script itself; the dev DB credential resolution recipe in `feedback_dev_db_secret_pattern` (memory).

**Execution note:** operator-only; no source code changes. Treat the install run as the unit's deliverable.

**Test scenarios:** Test expectation: none — pure operator action, no code changed. Verification lives in the post-run DB + S3 checks above.

**Verification:**
- The two queries above return the expected rows / objects.
- A `thinkwork me -s dev` on the same agent shows the new skills in its workspace listing (sanity check via the operator's view).

---

### U2. E2E verify a finance skill fires on a fresh thread

**Goal:** Demonstrate that with the catalog installed, the LLM actually reaches for a finance skill when handed an `.xlsx` and asked for analysis. The turn record's `usage.tool_invocations` carries a `skills` invocation referencing one of the three finance skill slugs, and that invocation surfaces in admin Thread Detail's existing expanded execution timeline.

**Requirements:** R-A1, R-A2.

**Dependencies:** U1.

**Files:** none modified. (Acceptance evidence: thread URLs, screenshots, DB query output.)

**Approach:**

- From `computer.thinkwork.ai/new` (signed in as a Marco user — i.e., the user's normal sign-in), attach `~/Desktop/docs/General-Ledger.xlsx` (or another finance workbook from the same directory) and prompt: "What stands out in this financial statement? Cite specific values from the file."
- Wait for the turn to complete. Open the thread in admin Thread Detail.
- Verify the expanded **Thinking** row's execution timeline contains a `skills` invocation entry (the AgentSkills built-in tool name), with the skill slug visible in its input preview (e.g., `{"name": "finance-statement-analysis"}` or similar shape).
- Cross-check via DB:
  ```sql
  SELECT id, usage_json->'tool_invocations'
    FROM agent_runs
    WHERE thread_id = '<test-thread-uuid>'
    ORDER BY started_at DESC LIMIT 1;
  ```
  Confirm the JSON array contains an entry with `tool_name = 'skills'` (or whatever AgentSkills exposes the tool as — verify the actual name string at this step rather than assuming).

**Patterns to follow:** the finance-pilot e2e ran during the pilot plan's verification phase — same approach, different expected output.

**Test scenarios:**

- *Covers R-A1, R-A2:* Fresh thread + `.xlsx` attachment + finance-shaped prompt → turn record has a `skills` tool invocation entry. (Behavioral acceptance; not a unit test.)
- *Edge case — no spreadsheet attached:* The same prompt without an attachment should **not** trigger a finance-skill call. (Sanity check that the skill is gated on context, not always-invoked.)
- *Edge case — non-finance workbook:* A non-financial `.xlsx` (e.g., a list of customer addresses) should not trigger a finance skill, or should trigger and the model should self-correct in its analysis. Worth noting but not blocking.

**Execution note:** observation-first. If U2 fails (the LLM ignores the skill and just calls `file_read` like before), do **not** patch by speculatively editing AGENTS.md. First read the actual `<available_skills>` XML in the run's invocation logs (`SELECT input_preview FROM agent_turn_invocations WHERE turn_id = ...`) to confirm the skills are reaching the model. Then either tighten the SKILL.md `description` frontmatter or add explicit routing prose to Marco's AGENTS.md — whichever lines up with what the trace shows.

**Verification:**
- The admin Thread Detail Activity panel's expanded **Thinking** row shows a `skills` (or equivalently-named) invocation with a finance-* slug.
- The DB query above confirms the same.
- The Computer message references content the model could only have produced by following the SKILL.md (e.g., uses the audit framework's specific terminology if `finance-audit-xls` fired).

---

### U3. AGENTS.md routing reinforcement (CONDITIONAL — only if U2 fails)

**Goal:** If U2 shows the model is not reaching for any finance skill despite `<available_skills>` XML being present, add explicit routing prose to Marco's AGENTS.md so the model prefers the finance skill on spreadsheet-shaped requests.

**Requirements:** R-N1.

**Dependencies:** U2 (only fires if U2's primary verification fails).

**Files:**
- `packages/system-workspace/AGENTS.md` (or Marco's tenant-level AGENTS.md, depending on inheritance — verify which file Marco actually composes from before editing)

**Approach:**

- Add one routing paragraph: when the user attaches an `.xlsx` / `.xls` / `.csv` and asks for analysis, prefer `finance-statement-analysis` for narrative requests, `finance-audit-xls` for data-quality requests, and `finance-3-statement-model` for projections.
- Keep it concise — three sentences max. The point is to bias the LLM, not lecture it.
- After editing, the same workspace-files PUT path triggers `deriveAgentSkills` automatically.

**Patterns to follow:** existing routing prose in `packages/system-workspace/AGENTS.md` for the artifact-builder skill.

**Test scenarios:** Test expectation: none — content edit, behavior verified by re-running U2's e2e.

**Verification:** Re-run U2's prompt and confirm the model now invokes a finance skill.

---

## Scope Boundaries

### In Scope

- Running the existing install script against dev for Marco.
- E2E verification that a finance skill fires on a fresh thread.
- Conditional AGENTS.md routing reinforcement if the model doesn't reach for the skill on its own.

### Deferred to Follow-Up Work

- **Skill meta-tool wire-up** (origin §U4, `skill_meta_tool.py:359`). Becomes load-bearing when we ship a script-execution skill. Likely a separate plan focused on the cutover from AgentSkills' built-in `skills` tool to the in-house `Skill(name, args)` meta-tool.
- **`skill.activated` audit emit** (origin §U6). Tied to the meta-tool wire-up — defers with it.
- **Tenant-level enable/disable surface for skills.** Currently per-agent only via AGENTS.md composition. Multi-tenant rollout will want a tenant-scoped on/off control.
- **Skill catalog UI in admin.** Listing what skills are installed per agent, showing version, last-installed timestamp.

### Outside this product's identity

- Re-implementing Anthropic's `agentskills.io` contract. We borrow the shape and the SKILL.md content; we are not building a competing skill registry.

---

## System-Wide Impact

- **Database (`agent_skills` table):** Three new rows for Marco. No schema change.
- **S3 (`thinkwork-dev-storage`):** ~9-15 new objects under Marco's workspace `skills/` prefix.
- **Strands runtime:** No code change. The next cold start (or workspace re-bootstrap) picks up the new SKILL.md via the existing `bootstrap-workspace.sh` + `register_skill_tools` path.
- **Admin Thread Detail UI:** No code change. The existing expanded-timeline rendering already shows `skills` invocations because they flow through `usage.tool_invocations` like any other tool call.
- **Cost:** Negligible. Three S3 PUT operations per install. The runtime cost increase is "the model is now using a more verbose skill SKILL.md as context" — adds a few hundred tokens per finance-shaped turn.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM ignores skills, keeps freeform analysis | Medium | High (defeats the demo) | U3 conditional — AGENTS.md routing prose. If even that fails, tighten SKILL.md `description` frontmatter. |
| Token expires mid-install | Low | Low (script is idempotent on re-run) | Re-run with fresh `thinkwork login -s dev`. |
| `deriveAgentSkills` regression silently drops finance | Low | Medium | DB verification step (U1 verification SQL) catches missing rows before declaring U1 done. |
| Workspace re-bootstrap timing — agent might run before skill is materialized | Medium | Medium (one bad turn, then it works) | Either wait for the 15-min reconciler (`project_agentcore_default_endpoint_no_flush`) or issue an explicit endpoint-update workaround; document which path was taken in the PR. |
| Skill SKILL.md frontmatter mismatch breaks `register_skill_tools` discovery | Low | High | Pre-flight: read each finance SKILL.md and confirm frontmatter passes `packages/skill-catalog/scripts/skill-md-frontmatter.test.ts` shape before running install. |

---

## Dependencies / Prerequisites

- Origin pilot plan units U5 (skill bundles) and U7 (install script) shipped — confirmed on `origin/main` at commits `9861ae95` and `ab3c4b40`.
- Admin user has Cognito access to dev (the operator's normal sign-in).
- `aws` CLI authenticated to the dev account for verification queries (already in place per session memory).
- Marco agent UUID `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c` in tenant `sleek-squirrel-230` (confirmed via diagnosis).

---

## Verification (Acceptance)

A reviewer can declare the plan complete when:

1. The three DB queries in U1 verification return the expected rows / objects.
2. A fresh chat thread on Marco with an attached `.xlsx` produces a turn record whose `usage.tool_invocations` carries a `skills`-shaped invocation referencing one of the finance slugs (U2 verification).
3. The same invocation is visible in admin Thread Detail's expanded **Thinking** timeline for that thread.
4. The Computer message references content that could only have come from following the skill's SKILL.md (terminology, framework, structure) — i.e., the skill actually influenced the output, not just appeared in the trace.

---

## Outstanding Questions

- *Defer to implementation.* What exact tool name does AgentSkills register for SKILL.md loading? The plugin docstring says `skills` but the actual registered name is best verified empirically during U2 (read `tool_name` strings from `usage.tool_invocations` on a finance turn).
- *Defer to implementation.* Does `deriveAgentSkills` activate skills as `enabled=true` by default on PUT, or does the operator need a follow-up GraphQL mutation to enable them? Read `packages/api/src/lib/derive-agent-skills.ts` during U1 and adjust if the install isn't enough.
