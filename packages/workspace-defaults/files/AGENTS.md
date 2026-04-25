# AGENTS.md

This is the Layer-1 Map for the agent. It explains the root folder, names the
sub-agents, and assigns specialist skills. Edit this file when you add, rename,
or reorganize sub-agents. The runtime, `delegate_to_workspace`, and the agent
builder all read the routing table below.

## Who I am

_(One sentence: who this agent is and what work it owns.)_

## Folder model

```
.                    root identity, guardrails, platform rules, and routing
memory/              durable lessons, preferences, contacts
skills/              optional local skills available to this agent
<sub-agent>/         specialist folder with its own CONTEXT.md, optional
                     skills/, and optional memory/
```

The folder is the agent: specialization comes from the files under the folder,
not from a separate agent registry. A thin sub-agent can be just
`expenses/CONTEXT.md`; it inherits root identity, guardrails, platform rules,
and template defaults through the workspace overlay.

`memory/` and `skills/` are reserved folder names at every depth. When a
sub-agent writes memory, paths are relative to the agent root, for example
`expenses/memory/lessons.md`.

## Routing

| Task                                       | Go to                | Read                              | Skills                       |
| ------------------------------------------ | -------------------- | --------------------------------- | ---------------------------- |
| _add a row when you create a sub-agent_    | _e.g. `expenses/`_   | _e.g. `expenses/CONTEXT.md`_      | _comma-separated slugs_      |

## Naming conventions

- Sub-agent folders are short, lowercase, hyphenated — `expenses/`, `customer-support/`, `legal/`.
- Reserved folder names — `memory/` and `skills/` — are never sub-agents at any depth.
- Skill slugs reference platform skills or local skills under `<folder>/skills/<slug>/SKILL.md`.
- Local skills resolve nearest-folder-first; the platform catalog is the fallback.
- Recursion depth is capped at 5 levels of sub-agents (soft warning at depth 4).
