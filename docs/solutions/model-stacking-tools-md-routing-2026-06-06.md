---
title: "Model stacking with TOOLS.md routing"
date: 2026-06-06
status: active
---

# Model Stacking with TOOLS.md Routing

ThinkWork supports model stacking by combining a user-selected parent turn
model with ThinkWork-native `TOOLS.md` routes for specific tool calls. The
parent model remains the planner/reasoning model for the turn, while a matching
tool call can run through a different approved child model and report separate
token and cost evidence.

`TOOLS.md` is the machine-enforced tool policy file for this contract. It is
not a general external standard. `AGENTS.md`, `SPACE.md`, `CONTEXT.md`, and
`USER.md` may explain expectations in prose, but the Pi runtime enforces only
the supported machine-readable `TOOLS.md` frontmatter keys.

## Syntax

Declare routes in YAML frontmatter at the top of `TOOLS.md`:

```yaml
---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: us.anthropic.claude-haiku-4-5-20251001-v1:0
    reason: Use the cheaper model for the analyst subtask.
---
# Tools
```

Fields:

- `tool`: required tool name. The v1 true-stacking target is
  `workspace_skill`.
- `match`: optional equality matcher. For `workspace_skill`, use `slug` to
  target one installed skill.
- `model`: required child model ID.
- `reason`: optional human-readable explanation shown in policy/source context.

## Precedence

Policy layers are resolved from lowest to highest precedence:

1. Agent root `TOOLS.md`
2. Active Space `TOOLS.md`
3. Active workspace/folder `TOOLS.md`, when available in the rendered tuple
4. User workspace `TOOLS.md`

Higher-precedence files replace lower-precedence routes with the same `tool`
and `match` signature. Precedence does not grant access: the selected child
model must still be available in `model_catalog` and approved for the user.
Unapproved child models fail loudly instead of silently falling back.

## Demo Pattern

For the customer demo, approve the user-selected parent model and the intended
child model, then route the `financial-analysis` skill to the child model:

```yaml
---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: us.anthropic.claude-haiku-4-5-20251001-v1:0
    reason: user demo override wins
---
# Tools
```

Run a turn with a different parent model selected in the composer, such as
`us.anthropic.claude-sonnet-4-5-20250929-v1:0`. The trace should show the
parent turn model separately from the routed tool model.

After the turn completes, open Settings -> Activity -> Thread Detail -> the
`Tool: workspace_skill` row. The tool row and detail dialog should show the
child model, input tokens, output tokens, routing status, match, and rule
source. Finalization also records child model cost evidence separately from the
parent LLM cost row.

For repeatable verification and live demo setup/cleanup, use
`docs/verification/model-stacking-e2e.md`.
