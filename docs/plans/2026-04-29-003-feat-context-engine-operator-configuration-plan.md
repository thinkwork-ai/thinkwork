---
title: "feat: Context Engine operator configuration follow-up"
type: feat
status: completed
date: 2026-04-29
origin: docs/plans/2026-04-29-001-feat-admin-memory-knowledge-center-plan.md
---

# feat: Context Engine operator configuration follow-up

## Overview

The Admin Knowledge page now gives operators a consolidated Memory, Wiki, Knowledge Bases, and Context Engine surface. The Context Engine tab has a working dev-stage test harness with adapter selection, agent/workspace targeting, Hindsight `recall`/`reflect` strategy, provider statuses, top hits, and full-result inspection.

The next slice should turn that harness into durable operator configuration. Tenant admins need persistent adapter policy, agent-template operators need clear overrides inside global limits, and support/debug users need a reliable effective-policy view that explains exactly what an agent will query before a chat starts.

---

## Requirements

- R1. Persist tenant-global Context Engine adapter eligibility and default participation for built-in provider families.
- R2. Reuse `tenant_mcp_context_tools` for MCP tool-level Context Engine approval/default state; do not create server-level MCP approval as a shortcut.
- R3. Expose Hindsight configuration that operators can actually change: `recall` vs `reflect`, timeout budget, and any supported bank/scope controls.
- R4. Expose agent-template Context Engine configuration as an override of tenant defaults, constrained to tenant-approved adapters.
- R5. Show agent-level effective Context Engine policy: tenant defaults, template overrides, final enabled adapters, and any explicit agent drift.
- R6. Keep raw Memory, Wiki, and KB inspection separate from Context Engine routing configuration.
- R7. Preserve dedicated mobile Wiki search; do not route the existing Wiki tab through Context Engine as a side effect.
- R8. Provider failures and no-hit states remain provider-local statuses with latency/reason details.
- R9. Strands and Pi continue to expose Context Engine tools consistently and prefer split Context Engine tools for explicit memory/wiki lookup.

---

## Scope

### In Scope

- Tenant/global adapter configuration API and persistence.
- Admin UI for adapter defaults and provider-specific settings.
- Template Context Engine configuration polish.
- Agent effective-policy read model and display.
- MCP context-tool approval/default management using the existing MCP context-tools table.
- Dev-stage e2e verification through Admin, MCP, Strands/Pi traces, and iOS Simulator.

### Out of Scope

- A full mobile Context Search screen.
- Replacing mobile Wiki search with Context Engine.
- Merging Hindsight, Wiki, Workspace Files, KBs, or MCP results into a single physical index.
- Write-capable `act_on_context` behavior.
- Broad agent-level override editing beyond explicit support/debug exceptions.

---

## Current State

- `/knowledge/*` is the Admin route family for Memory, Wiki, Knowledge Bases, and Context Engine.
- The Context Engine test harness can explicitly select adapters and target an agent for Workspace Files.
- Workspace Files need an agent target to search agent S3 workspace content such as `USER.md`.
- Hindsight `reflect` produces better answer-like memory output but can be slower than the 50ms recall path because reranking/reflection is materially different work.
- Wiki search should stay separate and fast; mobile Wiki uses the dedicated compiled-wiki search path.
- Pi and Strands should expose Context Engine split tools consistently so raw Hindsight is not selected for normal memory lookup.

---

## Implementation Units

### U1. Persist Tenant Adapter Policy

**Goal:** Make global Context Engine adapter settings durable instead of test-harness-only state.

**Files likely touched:**

- `packages/database-pg/src/schema/*`
- `packages/database-pg/drizzle/*_context_engine*.sql`
- `packages/api/src/lib/context-engine/admin-config.ts`
- `packages/api/src/handlers/mcp-context-engine.ts`
- `apps/admin/src/lib/context-engine-api.ts`
- `apps/admin/src/routes/_authed/_tenant/knowledge/context-engine.tsx`

**Approach:**

- Add a tenant adapter settings table for non-MCP provider families: provider id, family, enabled, default_enabled, config JSON, last-tested metadata, timestamps.
- Keep MCP approval/default state in `tenant_mcp_context_tools`.
- Return one normalized adapter catalog to Admin that merges built-in providers and eligible MCP tools.
- Validate that disabled/ineligible providers cannot become defaults.

**Verification:**

- Unit tests for default resolution and invalid default attempts.
- Admin test query with no explicit provider selection uses persisted tenant defaults.

### U2. Add Provider-Specific Configuration UI

**Goal:** Let operators tune provider behavior from the Context Engine tab.

**Approach:**

- Add a configuration dialog or sheet per adapter.
- For Hindsight, expose `recall` vs `reflect`, timeout, and supported bank/scope controls.
- For Workspace Files, show that an agent target is required for test queries and explain searched/skipped counts.
- For Bedrock KB, show eligible KB count and why a provider is skipped.
- For MCP, expose tool-level approval/default status only for read-only/search-safe tools.

**Verification:**

- Hindsight mode change affects subsequent Admin test query and is visible in hit metadata.
- Disabled provider is absent from default test runs but still explainable in the adapter list.

### U3. Finish Template Context Engine Override Semantics

**Goal:** Make template-level Context Engine configuration clearly inherit from and override tenant defaults.

**Approach:**

- Show inherited adapter list on the Template Context Engine card.
- Config dialog supports "use tenant defaults" plus explicit adapter inclusion/exclusion.
- Validate template overrides against tenant-approved adapters.
- Runtime config resolver emits a normalized Context Engine config consumed by Strands and Pi.

**Verification:**

- Template with Context Engine disabled produces no runtime `query_context` tools.
- Template with Context Engine enabled and inherited defaults produces runtime tools and provider defaults.
- Template cannot enable globally disabled providers.

### U4. Agent Effective Policy Display

**Goal:** Give operators a read-only explanation of what an agent will actually use.

**Approach:**

- Add an agent effective-policy read model from the same resolver used for runtime config.
- Display tenant defaults, template overrides, final provider list, and any agent-level drift.
- Surface Hindsight under Context Engine, not as a peer raw tool, for normal configuration.

**Verification:**

- Agent effective policy matches runtime config for the same agent id.
- Agent with no override clearly shows inherited values.

### U5. Runtime and Mobile E2E Verification

**Goal:** Prove the configuration works in the places users actually exercise it.

**Approach:**

- Admin dev server: run `Knowledge → Context Engine` tests for Hindsight, Wiki, Workspace Files, and skipped KB.
- MCP: call `query_context`, `query_memory_context`, and `query_wiki_context` against dev with real data.
- iOS Simulator: start a new chat and verify the agent uses Context Engine tools for memory fetch rather than raw Hindsight.
- DB traces: confirm tool invocation metadata records Context Engine built-ins distinctly from raw MCP/Hindsight calls.

**Verification:**

- Workspace Files returns a known `USER.md` hit when an agent target is selected.
- Hindsight `reflect` returns synthesized memory output and records provider latency.
- Wiki path remains fast and separate.
- Mobile Wiki tab still uses dedicated Wiki search.

---

## Risks

| Risk | Mitigation |
|---|---|
| UI settings become decorative because runtime still uses env defaults | Drive runtime registration from the same resolved config and test resolver output |
| Hindsight tuning hides reranker/reflection latency instead of explaining it | Show strategy, timeout, latency, and provider-local degraded status |
| MCP default approval becomes too broad | Keep approval at tool level and require read-only/search-safe metadata |
| Agent overrides create unexplainable drift | Start with read-only effective policy and narrow explicit override exceptions |
| Mobile Wiki regresses to slow semantic memory search | Keep existing mobile Wiki path out of this plan |

---

## Verification Checklist

- `pnpm --filter @thinkwork/api test -- src/lib/context-engine`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`
- `pnpm --filter @thinkwork/agentcore-pi typecheck`
- `uv run pytest packages/agentcore-strands/agent-container/test_context_engine_tool.py`
- Admin browser smoke at `/knowledge/context-engine`
- iOS Simulator smoke: new chat fetches memory through Context Engine
- MCP smoke: `query_context`, `query_memory_context`, `query_wiki_context`

---

## Related

- `docs/plans/2026-04-29-001-feat-admin-memory-knowledge-center-plan.md`
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`
- `docs/src/content/docs/applications/admin/knowledge.mdx`
- `docs/src/content/docs/api/context-engine.mdx`
