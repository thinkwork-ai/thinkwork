# AGENTS.md

The Layer-1 Map for this agent. Edit me when you add or rename sub-agents,
when you reshape the file layout, or when you change which skills which
specialist owns. Everything else flows from here — `delegate_to_workspace`
reads the routing table; the agent builder reads it for the tree view; the
runtime reads it to compose the system prompt at boot and on the next turn
after an edit.

## Who I am

_(One sentence: who this agent is, what it's for. Edit me.)_

## How this folder is organized

```
.                   ← root identity, guardrails, routing
memory/             ← durable lessons, preferences, contacts (write_memory tool)
skills/             ← local skills authored alongside this agent (optional)
<sub-agent>/        ← specialist sub-agent — its own CONTEXT, optional skills/
```

## Routing

| Task                                       | Go to                | Read                              | Skills                       |
| ------------------------------------------ | -------------------- | --------------------------------- | ---------------------------- |
| _add a row when you create a sub-agent_    | _e.g. `expenses/`_   | _e.g. `expenses/CONTEXT.md`_      | _comma-separated slugs_      |

## Naming conventions

- Sub-agent folders are short, lowercase, hyphenated — `expenses/`, `customer-support/`, `legal/`.
- Reserved folder names — `memory/` and `skills/` — are never sub-agents at any depth.
- Skill slugs reference platform skills in `packages/skill-catalog/<slug>/` or local skills under `<folder>/skills/<slug>/SKILL.md`. Local skills resolve nearest-folder-first; platform catalog is the fallback.
- Recursion depth is capped at 5 levels of sub-agents (soft warning at depth 4).
