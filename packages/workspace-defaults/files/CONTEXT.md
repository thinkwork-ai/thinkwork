# CONTEXT.md - Task Router

This file does one job: route a task to the right workspace. `AGENTS.md`
(always loaded) is the map — folder structure, naming rules, and the skill
inventory live there. Read this file when you need to decide where a task
belongs and what to load for it, then go do the work in that workspace.

Keep it short. Detailed instructions belong in the workspace this file points
to — the active Space's `SPACE.md`, a specialist workspace's `CONTEXT.md`, or
a skill's own instructions — not here.

## Scope

The agent's top-level scope. Describe the role this agent plays at the
highest level — sub-agent folders override with their own `CONTEXT.md` for
narrower scope.

_(Edit me with: what this agent does, who it serves, what kinds of tasks
fall to it before delegation, and what's explicitly out of scope.)_

## Task Routing

One row per recurring kind of task. Keep rows task-shaped ("Prepare the board
pack", not "finance"). The "You'll Also Need" column names cross-workspace
resources to load — without it, work started in one workspace misses context
that lives in another.

| Your Task | Go Here | You'll Also Need |
| --------- | ------- | ---------------- |

## Workspace Summary

One line per place work happens — a Space or a specialist workspace folder:
what it's for and which skills or tools it leans on. Read the workspace's own
context file when working in it, not this file.

| Workspace | Purpose | Skills & Tools |
| --------- | ------- | -------------- |

## Routing

Generated from the attached capability set at render time — do not edit this
section. Rows appear here as skills are attached to the agent.

## What NOT to Do

- Don't duplicate `AGENTS.md` content here — this file routes, the map
  orients.
- Don't inline workspace instructions here — link to the workspace's own
  context file instead.
- Don't load everything: follow the routing row's "You'll Also Need" column
  and skip the rest.
