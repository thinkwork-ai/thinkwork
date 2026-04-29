---
date: 2026-04-29
topic: admin-knowledge-center
status: active
related:
  - docs/brainstorms/2026-04-28-context-engine-requirements.md
  - docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md
  - docs/brainstorms/2026-04-26-user-knowledge-reachability-and-knowledge-pack-requirements.md
---

# Admin Knowledge Center

## Problem Frame

Thinkwork previously exposed memory, compiled wiki pages, knowledge bases, and Context Engine-related provider controls across separate admin surfaces. That made sense while each feature was independent, but it made operator testing and configuration harder: the admin had to jump between "Memories", "Wiki Pages", "Knowledge Bases", "Capabilities", templates, and agents to understand what context an agent will actually use.

Admin needs one **Knowledge** center that groups the existing surfaces under a single navigation item, adds Context Engine adapter configuration, and makes the effective provider policy visible across global tenant defaults, agent templates, and individual agents. "Knowledge" is the operator umbrella; Memory, Wiki, Knowledge Bases, and Context Engine are tabs within it.

This document is focused on the Admin UI/product shape. The shared Context Engine provider contract remains defined by `docs/brainstorms/2026-04-28-context-engine-requirements.md`.

---

## Actors

- A1. Tenant admin: configures the tenant's memory, wiki, knowledge base, and Context Engine provider posture.
- A2. Agent/template operator: decides which context tools and provider defaults apply to an agent template or an individual agent.
- A3. Support/debug operator: verifies why a query did or did not use a provider and whether partial provider failures are expected.
- A4. Agent runtime: receives the effective context configuration when built-in tools are injected.

---

## Key Flows

- F1. Admin reviews all knowledge surfaces
  - **Trigger:** The admin opens the unified Knowledge navigation item.
  - **Actors:** A1, A3
  - **Steps:** The page opens with top tabs similar to Capabilities. The admin can switch between Memory, Wiki, Knowledge Bases, and Context Engine without changing sidebar sections. Existing search, table, graph, and detail flows remain available inside their tabs.
  - **Outcome:** The admin has one place to inspect stored memory, compiled wiki knowledge, external KBs, and context routing configuration.
  - **Covered by:** R1, R2, R3, R4

- F2. Admin configures Context Engine adapters
  - **Trigger:** The admin opens the Context Engine tab.
  - **Actors:** A1, A3
  - **Steps:** The admin reviews each adapter family, sees status and recent test results, enables or disables tenant-level eligibility, chooses default/opt-in behavior, and configures safe operational knobs such as mode, timeout budget, and provider-specific strategy where supported.
  - **Outcome:** Context Engine provider behavior is operator-manageable without editing deployment configuration or guessing which screen owns which source.
  - **Covered by:** R5, R6, R7, R8, R9

- F3. Template operator chooses default context behavior
  - **Trigger:** The operator edits an agent template's built-in tools or context settings.
  - **Actors:** A2, A4
  - **Steps:** The template can inject Context Engine tools and choose a context profile derived from global defaults. The operator may override provider inclusion within tenant-approved limits. The UI shows whether each setting is inherited or overridden.
  - **Outcome:** Templates can intentionally opt agents into `query_context`, `query_memory_context`, and related tools without duplicating tenant-wide provider administration.
  - **Covered by:** R10, R11, R12, R13

- F4. Operator inspects an agent's effective context policy
  - **Trigger:** The operator opens an agent's configuration or troubleshooting view.
  - **Actors:** A2, A3
  - **Steps:** The UI shows the effective provider policy after global defaults and template overrides are applied. Agent-level overrides are available only for narrow, intentional exceptions and clearly display drift from the template.
  - **Outcome:** Operators can explain exactly why an agent has two context tools, why Hindsight is included through Context Engine, or why a provider is disabled.
  - **Covered by:** R13, R14, R15

---

## Requirements

**Unified admin navigation**
- R1. Admin replaces the separate primary sidebar entries for Memories, Wiki Pages, and Knowledge Bases with one combined Knowledge navigation item.
- R2. The combined page uses top tabs, visually matching the Capabilities page pattern, for at least Memory, Wiki, Knowledge Bases, and Context Engine.
- R3. Existing Memory table, graph, search, pagination, and user filtering behaviors remain available inside the Memory tab.
- R4. Existing Wiki page list, graph/search controls, source detail, and Knowledge Base list/detail flows remain reachable from the combined page.

**Context Engine adapter management**
- R5. The Context Engine tab lists adapter families such as Hindsight Memory, Wiki, Bedrock Knowledge Bases, workspace/filesystem, and approved MCP tools.
- R6. Each adapter shows operator-relevant status: enabled state, default vs opt-in policy, last test result, last tested time, latency, and any partial-failure reason.
- R7. Tenant-global configuration controls which adapters are eligible at all and which eligible adapters participate by default.
- R8. Provider-specific settings are exposed only when they are product-relevant to operators, such as Hindsight recall vs reflect mode, timeout budget, selected bank/scope, KB inclusion, and MCP tool approval/default state.
- R9. The Context Engine tab includes a safe test query flow that shows provider statuses and top cited hits without requiring a full agent chat.

**Global to template to agent hierarchy**
- R10. Tenant-global settings are the source of truth for adapter eligibility, credentials/connection posture, provider health, and default provider policy.
- R11. Agent templates can opt into built-in Context Engine tools and choose a default context profile derived from global settings.
- R12. Template overrides may narrow or expand default provider inclusion only within globally approved providers; templates cannot make an unapproved adapter available.
- R13. Agent views show the effective context configuration produced by global defaults plus template settings, including inherited vs overridden values.
- R14. Agent-level overrides are allowed only for explicit exceptions, testing, or support workflows and must be visibly marked as drift from the template.
- R15. The UI must make clear that Hindsight is an adapter inside Context Engine, not a separate peer tool when an agent is using `query_context` or `query_memory_context`.

**Operator safety and clarity**
- R16. The combined page distinguishes raw source inspection from Context Engine routing so admins do not confuse "search memories directly" with "configure what agents query by default".
- R17. MCP providers remain approved at the individual tool level before they can participate in Context Engine default search.
- R18. Any provider failure or timeout is shown as partial degradation, not as a generic page or agent configuration failure.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given an admin currently uses separate Memories, Wiki Pages, and Knowledge Bases sidebar entries, when the new page ships, the sidebar has one combined Knowledge item and each existing surface is reachable through top tabs.
- AE2. **Covers R5, R6, R9, R18.** Given Hindsight times out while Wiki succeeds, when an admin runs a Context Engine test query, the result shows Hindsight as degraded with latency/error detail and still shows successful Wiki results.
- AE3. **Covers R10, R11, R12.** Given Bedrock KB is globally disabled, when an operator edits a template context profile, the template cannot enable Bedrock KB as a default provider.
- AE4. **Covers R13, R14, R15.** Given a template injects `query_context` and an agent has no override, when the operator opens the agent context view, Hindsight appears as an inherited Context Engine adapter rather than as a separate raw Hindsight tool.
- AE5. **Covers R17.** Given an MCP server exposes one search-safe tool and one mutation tool, when the admin configures Context Engine adapters, only the search-safe tool is eligible for Context Engine approval/default search.

---

## Success Criteria

- Admins can inspect Memory, Wiki, Knowledge Bases, and Context Engine configuration from the single Knowledge sidebar destination.
- Dogfood testing becomes faster because an operator can run a Context Engine query and see provider statuses without opening mobile or an agent chat.
- Template and agent configuration stop showing Hindsight as a confusing peer when it is actually being used through Context Engine.
- Planning can proceed without re-deciding the hierarchy: global tenant defaults govern eligibility and operations, templates choose context profiles/tool injection, and agents primarily show effective config with narrow overrides.

---

## Scope Boundaries

- This does not merge Hindsight, Wiki, and Knowledge Bases into one backend store. It combines the admin product surface and Context Engine configuration.
- This does not replace the existing source-specific inspection views; they move under tabs and keep their current core workflows.
- This does not create the true mobile Context Search screen. Mobile remains covered by `docs/brainstorms/2026-04-28-context-engine-requirements.md`.
- This does not make arbitrary MCP tools searchable. MCP approval remains read-only/search-safe and tool-level.
- This does not require every provider knob to be editable at every hierarchy layer; global, template, and agent each own different levels of control.

---

## Key Decisions

- **Create a focused Admin UI requirements doc.** The Context Engine provider contract remains separate, while this doc owns admin navigation, configuration hierarchy, and operator workflows.
- **Use one combined navigation item.** Memory, Wiki, and Knowledge Bases are now related context surfaces under Knowledge and should not compete as peer sidebar items.
- **Use the Capabilities tab pattern.** The admin already has a precedent for top-level tabs across related operational surfaces.
- **Use Global -> Template -> Agent, but with scoped responsibility.** Global owns adapter eligibility and operations; templates own default context profile and built-in tool injection; agents show effective configuration and support narrow exceptions.
- **Expose Hindsight through Context Engine in agent-facing configuration.** Raw Hindsight tools may exist for debugging, but normal agent configuration should show Hindsight as a Context Engine adapter.

---

## Dependencies / Assumptions

- Existing Admin surfaces included separate Memory, Wiki Pages, and Knowledge Bases pages before the Knowledge route consolidation.
- Existing Admin Capabilities pages already provide a usable top-tab pattern.
- Context Engine provider concepts, including `query_context`, normalized providers, provider status, and MCP tool-level approval, are defined in `docs/brainstorms/2026-04-28-context-engine-requirements.md`.
- The first implementation can preserve existing source-specific data flows while reorganizing navigation and adding Context Engine configuration incrementally.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] Exact route migration and redirect strategy for existing `/memory`, `/wiki`, and `/knowledge-bases` links.
- [Affects R5-R9][Technical] Which Context Engine adapter settings already have persisted backend configuration and which need new API support.
- [Affects R8][Needs research] Hindsight-specific operator settings: whether reflect vs recall, reranker behavior, bank selection, and timeout budgets should be separately configurable or folded into named profiles.
- [Affects R11-R14][Technical] Exact storage model for global, template, and agent context profile inheritance.
- [Affects R9][Technical] Whether the Admin test query calls the same deployed Context Engine endpoint as Strands/Pi or an admin-only diagnostic wrapper.

---

## Next Steps

## Implementation Checkpoint — 2026-04-29

- Sidebar product copy is now **Knowledge**, not "Memory & Knowledge".
- The Knowledge route family uses tabs: Memory, Wiki, Knowledge Bases, and Context Engine.
- The Context Engine tab has become the primary operator test harness. It supports adapter selection, agent/workspace targeting, Hindsight recall vs reflect strategy, provider statuses, top hits, and full-result dialogs.
- Agent Template configuration exposes Context Engine as a built-in tool with provider/profile configuration. Agent-level broad overrides remain a follow-up.
- Documentation and screenshots that still describe Memory, Wiki Pages, and Knowledge Bases as separate sidebar destinations should be refreshed before shipping broadly.
