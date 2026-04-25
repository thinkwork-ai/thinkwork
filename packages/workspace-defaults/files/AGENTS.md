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

Async work is folder-native too. Use `wake_workspace(target, request_md, ...)`
when a specialist can run later, wait for human review, or resume this agent
after completion. The platform turns eventful file writes into canonical events;
agents should not write orchestration files directly.

## Routing

| Task                                       | Go to                | Read                              | Skills                       |
| ------------------------------------------ | -------------------- | --------------------------------- | ---------------------------- |

Add one row per sub-agent. For example, an `expenses/` sub-agent would point
`Go to` at `expenses/` and usually read `expenses/CONTEXT.md`.

## Naming conventions

- Sub-agent folders are short, lowercase, hyphenated — `expenses/`, `customer-support/`, `legal/`.
- Reserved folder names — `memory/` and `skills/` — are never sub-agents at any depth.
- Skill slugs reference platform skills or local skills under `<folder>/skills/<slug>/SKILL.md`.
- Local skills resolve nearest-folder-first; the platform catalog is the fallback.
- Recursion depth is capped at 4 levels of sub-agents.
