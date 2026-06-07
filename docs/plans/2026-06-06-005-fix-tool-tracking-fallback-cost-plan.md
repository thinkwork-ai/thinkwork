---
title: Fix Tool Tracking Fallback Model And Cost Evidence
status: active
created: 2026-06-06
origin: user-reported Activity thread detail bug
---

# Fix Tool Tracking Fallback Model And Cost Evidence

## Problem

Activity thread detail currently shows model, token, and cost evidence only for tool calls that have explicit model-routing overrides. Non-overridden tools such as `web_search` and `web_extract` render without model/tokens/cost, even though they should fall back to the composer-selected parent model. For overridden MCP server calls, child model costs are rendered on rows but are not included in the turn header total, so visible row costs can exceed the reported turn cost.

## Scope

In scope:

- Preserve explicit tool/model override evidence for MCP server routing.
- Add fallback evidence for non-overridden tool calls using the parent/composer model captured for the turn.
- Attribute parent model tokens and cost across fallback tool calls so rows have model, input/output/cache token counts, and cost.
- Include routed child model cost rows in `ThreadTurn.totalCost` so the Activity header reflects parent plus child model cost.
- Verify the local Activity thread detail UI with a fresh non-MCP tool call and a routed MCP tool call.

Out of scope:

- Changing model-routing policy syntax.
- Changing composer selection behavior.
- Adding per-token internal tracing inside external tool implementations.
- Production manual deploys outside normal PR/merge flow.

## Requirements Trace

- User requirement: “end to end test with non-mcp tools tracking model, tokens, cost, etc.”
- User requirement: “If tool isn't overridden, then falls back to model chosen by composer.”
- User requirement: “It shouldn’t match specific MCP tool…the entire MCP server is the tool.”
- User requirement: “individual tool calls aren’t adding up to the correct amount for the turn.”

## Existing Patterns

- `packages/pi-runtime-core/src/agent-loop.ts` already emits `tool_invocations` and nested `model_routing` for overridden tool calls.
- `packages/api/src/lib/chat-finalize/process-finalize.ts` already normalizes routed tool calls, records child cost events with `metadata.parent_request_id`, and flattens model evidence onto tool invocations.
- `apps/spaces/src/components/settings/SettingsActivityExecutionTrace.tsx` renders row evidence from flat tool invocation fields and merged route events.
- `packages/api/src/graphql/resolvers/triggers/threadTurns.query.ts` already batch-loads cost events for Activity summaries.

## Implementation Units

### U1: Persist Fallback Tool Model Evidence

Files:

- Modify `packages/pi-runtime-core/src/types.ts`
- Modify `packages/api/src/lib/chat-finalize/process-finalize.ts`
- Test `packages/api/src/lib/chat-finalize/process-finalize.test.ts`

Approach:

- Extend tool invocation records with optional flat evidence fields: model, token counts, cost, status, and attribution metadata.
- In finalize, after parent cost recording and routed child cost recording, identify tool invocations without explicit routing evidence.
- Assign the turn parent/composer model to those fallback invocations.
- Distribute parent input/output/cache tokens and parent recorded cost across fallback invocations using deterministic integer token splitting and proportional cost splitting.
- Mark fallback rows with an attribution status such as `parent_model` so the UI can distinguish fallback evidence from explicit routing.
- Keep explicit routed model calls unchanged and do not add fallback attribution to already-routed rows.

Test scenarios:

- A turn with `web_search` and `web_extract`, parent model `moonshotai.kimi-k2.5`, and parent cost records both tool rows with model/tokens/cost.
- Fallback tool row costs sum to the parent recorded turn cost.
- A routed MCP tool keeps its explicit child model evidence and is not overwritten by fallback attribution.

### U2: Include Routed Child Costs In Activity Totals

Files:

- Modify `packages/api/src/graphql/resolvers/triggers/threadTurns.query.ts`
- Test `packages/api/src/graphql/resolvers/triggers/threadTurns.query.test.ts` or add focused coverage in an existing resolver test location if a harness exists.

Approach:

- Batch-load direct parent cost events by both `thread_turn.id` and `wakeup_request_id`.
- Batch-load child routed model cost events by `cost_events.metadata->>'parent_request_id'`.
- Return `totalCost` as the sum of direct parent request cost and child routed model request cost for each turn.

Test scenarios:

- A turn with a direct parent cost and two child cost events returns their sum.
- A turn with only direct parent cost keeps the previous total.
- A turn with no matching costs returns null rather than zero.

### U3: Render Fallback Evidence Clearly

Files:

- Modify `apps/spaces/src/components/settings/SettingsActivityExecutionTrace.tsx`
- Test `apps/spaces/src/components/settings/SettingsActivityThreadDetail.test.tsx`

Approach:

- Ensure usage-only timelines summarize cost/tokens from usage evidence when CloudWatch invocation logs are unavailable.
- Keep row rendering compact while showing fallback model, token counts, and cost for non-overridden tools.
- Avoid showing “not routed” for fallback rows.

Test scenarios:

- Activity detail renders `web_search` and `web_extract` with model, tokens, and cost from fallback evidence.
- Activity detail still renders MCP route rows with routed child model evidence.
- Execution summary does not display `0 in + 0 out · --` when usage evidence exists.

### U4: End-To-End Local Validation

Files:

- No code file required; validation evidence is recorded in final summary and PR body.

Approach:

- Run focused unit tests for finalize and Activity rendering.
- Run typecheck or package-level checks for changed workspaces.
- Use the local dev server at `localhost:5174` and the integrated browser/agent-browser to create or inspect a fresh non-MCP tool-triggering turn.
- Verify rows for `web_search`/`web_extract` show model, tokens, and cost.
- Verify a routed MCP server turn still shows the override model and the header total includes child model costs.

Test scenarios:

- Non-MCP web tool turn shows fallback composer model/tokens/cost per tool row.
- MCP Twenty CRM turn shows routed Haiku model/tokens/cost per server tool row.
- Header total is at least the sum of rendered routed child model rows plus parent/fallback attribution, within display rounding.

## Risks And Decisions

- Decision: fallback tool rows use deterministic attribution from the parent model invocation because Pi does not emit a separate child model request for non-overridden tools. This satisfies traceability while making the attribution explicit.
- Risk: row-level fallback cost is an attribution, not a separate billable request. The `parent_model` status should make that clear in detail views.
- Risk: UI displayed sums round to four decimals, so visible row totals can differ from headers by display rounding. Backend totals should use full precision.

## Verification

- `pnpm --filter @thinkwork/api exec vitest run src/lib/chat-finalize/process-finalize.test.ts`
- `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/SettingsActivityThreadDetail.test.tsx`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/spaces typecheck`
- Browser validation on `http://localhost:5174/settings/activity/...` with fresh non-MCP and MCP tool turns.
