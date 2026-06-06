---
title: "Model stacking end-to-end verification"
date: 2026-06-06
status: active
---

# Model Stacking End-to-End Verification

This runbook proves the demo-critical model-stacking path:

1. A user selects an approved parent model for the turn.
2. Layered `TOOLS.md` policy chooses a different approved model for a
   `workspace_skill` tool call.
3. The tool output records the child model plus input/output tokens.
4. Settings -> Activity -> Thread Detail -> Tool shows that model evidence.
5. An unapproved override is rejected without silently falling back.

## Automated Hermetic Proof

Run from the repository root:

```bash
bash scripts/model-stacking-e2e.sh
```

Equivalent package command:

```bash
pnpm --filter @thinkwork/api model-stacking:e2e
```

The proof uses literal `TOOLS.md` content and real production modules for the
parser, policy composer, `workspace_skill` extension, and Pi runtime event
capture. It does not mutate a deployed tenant.

## Demo Fixture Policy

Use a skill slug named `financial-analysis`.

Agent root `TOOLS.md`:

```yaml
---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: us.amazon.nova-micro-v1:0
    reason: agent baseline cheap pass
---
# Tools
```

Active Space `TOOLS.md`:

```yaml
---
modelRouting:
  - tool: workspace_skill
    match:
      slug: financial-analysis
    model: us.anthropic.claude-haiku-4-5-20251001-v1:0
    reason: space board-pack override
---
# Tools
```

User workspace `TOOLS.md`:

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

For the negative case, change only the user-level model to an unapproved model:

```yaml
model: us.anthropic.claude-opus-4-5-20251001-v1:0
```

## Live Demo Checklist

Use the normal merge/deploy pipeline before running live verification. Do not
manually mutate production outside approved demo tenant setup.

1. Approve the parent model and the intended child model for the demo user.
   Leave the negative-case model unapproved.
2. Select the parent model in the composer, for example
   `us.anthropic.claude-sonnet-4-5-20250929-v1:0`.
3. Add the three `TOOLS.md` files above at agent root, active Space, and user
   workspace levels.
4. Ensure the `financial-analysis` workspace skill exists under the agent
   workspace skill folder.
5. Start a new thread with a prompt such as:
   `Use the financial-analysis skill to summarize the margin risk in this board packet.`
6. Open Settings -> Activity -> the new thread -> the `Tool: workspace_skill`
   row.
7. Confirm the tool row displays the child model and input/output tokens.
8. Open the tool detail dialog and confirm the model-routing block shows:
   - `Model: claude-haiku-4-5-20251001`
   - non-zero input and output token counts
   - `Routing status: completed`
   - `Rule source` owner `user` and path `User/TOOLS.md`
9. Confirm the thread/trace evidence still shows the parent turn model as the
   composer-selected parent model.
10. Change user `TOOLS.md` to the unapproved model and rerun the same prompt.
11. Confirm the route is rejected visibly and no child model cost row is
    recorded for the unapproved model.

## Cleanup

After the demo, restore or remove the demo `TOOLS.md` files and remove any demo
thread or fixture skill only through normal tenant data-management paths. Keep
the automated hermetic proof in CI as the regression guard.
