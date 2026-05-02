---
title: "Recipe-catalog architecture for LLM-authored DSLs"
description: "Pattern for constraining LLM output to a platform-owned vocabulary (recipe catalog) with typed args, an emitter per entry, and a validator-feedback loop — rather than letting the LLM emit raw target language."
date: 2026-05-01
category: architecture-patterns
module: routines
problem_type: architecture_pattern
component: service_object
severity: high
tags:
  - llm-dsl
  - recipe-catalog
  - amazon-states-language
  - validator-feedback-loop
  - structured-output
  - routines
  - hitl
applies_when:
  - "An LLM must emit structured executable output (DSL, workflow, query) that the platform will run on behalf of users"
  - "The target language is rich enough that raw emission produces unsafe or unvalidatable results (e.g. raw ASL, raw SQL)"
  - "New capability needs to be exposed to the LLM without retraining — add a catalog entry instead"
  - "Observability and type-safety of LLM-generated workflows is a product requirement"
  - "A chat builder UX drives workflow authoring and needs graceful error recovery"
related_components:
  - assistant
  - background_job
  - tooling
---

# Recipe-catalog architecture for LLM-authored DSLs

## Context

ThinkWork's prior routine engine let the LLM emit a Python `code` field directly — unstructured text that the runtime executed. There was no typed argument surface, no schema to validate against, and no observability per step: the run-detail UI could only record "the agent ran" rather than "step 3 was a Slack send that took 400 ms and returned message ts X." When the Routines rebuild moved to AWS Step Functions as the execution substrate, raw Amazon States Language (ASL) was the natural target DSL — but raw ASL is too low-level for an LLM to reliably emit (ARN literals, exact JSONPath/JSONata syntax, Next/End wiring) and the resulting JSON is opaque to operators. The gap: the team needed the LLM to author structured executable output without teaching it the full ASL surface, and needed that output to be both type-checkable before it hits the runtime and readable by operators reviewing a routine's logic.

## Guidance

The pattern has five load-bearing parts:

**1. Catalog-as-data**

Recipes are `RecipeDefinition` entries in a TypeScript module (`packages/api/src/lib/routines/recipe-catalog.ts`). Each entry carries:

- `id` — stable string key used as the lookup token throughout the system
- `argSchema` — JSON Schema (draft 2019-09) describing the user-authored arguments
- `aslEmitter` — pure function `(args, ctx) => AslState` that produces the target-DSL fragment
- `resourceArnPattern` — regex for reverse-mapping emitted ARNs back to recipe ids

Because recipes are TypeScript code rather than database rows, the validator, emitters, and arg schemas share a single source of truth. Adding a recipe is a PR — not a tenant-config knob.

```typescript
// packages/api/src/lib/routines/recipe-catalog.ts
{
  id: "slack_send",
  displayName: "Send Slack message",
  description: "Post a message to a tenant Slack channel via the slack-send Lambda.",
  category: "notification",
  hitlCapable: false,
  argSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      channelId: { type: "string", minLength: 1 },
      text:      { type: "string", minLength: 1 },
      blocks:    { type: "array" },
    },
    required: ["channelId", "text"],
  },
  resourceArnPattern: /^arn:aws:states:::lambda:invoke$/,
  aslEmitter: (args, ctx) =>
    markRecipe(
      applySequencing(
        {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Parameters: {
            "FunctionName.$": "$$.Execution.Input.slackSendFunctionName",
            "Payload": {
              channelId: args.channelId,
              text:      args.text,
              ...(Array.isArray(args.blocks) ? { blocks: args.blocks } : {}),
            },
          },
          ResultSelector: { "messageTs.$": "$.Payload.messageTs" },
        },
        ctx,
      ),
      "slack_send",
    ),
}
```

Each emitted state's `Comment` field is stamped with `recipe:<id>` by `markRecipe()`, making recipe identity readable by both humans and the validator without inspecting ARNs.

The v0 catalog has 12 recipes across five categories: `control_flow` (`wait`), `invocation` (`agent_invoke`, `tool_invoke`, `routine_invoke`), `io` (`http_request`, `aurora_query`, `transform_json`, `set_variable`), `notification` (`slack_send`, `email_send`), `hitl` (`inbox_approval`), and `escape_hatch` (`python`).

**2. LLM scoped to catalog ids**

The system prompt in `apps/mobile/prompts/routine-builder.ts` names the recipe vocabulary in plain English but never shows the LLM raw ASL syntax or ARN patterns:

```
You build routines by composing **recipes** — small, well-typed building blocks like
`http_request`, `slack_send`, `agent_invoke`, `python`, and `inbox_approval`.
The exact recipe set + argument schemas for this tenant are injected separately
as the recipe catalog. **Do not invent recipe ids that aren't in the catalog.**
```

The prompt describes the catalog categories (`Connectors`, `Agent / tool`, `Sandbox`, `HITL`, `Control flow`) and the conditions under which each category applies, but defers the actual schema authority to the injected catalog. The LLM composes recipe ids and their user-authored args; it never authors raw ARNs or Next-pointer wiring.

**3. Catalog injected at session start**

`tenantToolInventory` (`packages/api/src/graphql/resolvers/routines/tenantToolInventory.query.ts`) is a single resolver that aggregates agents, MCP tools, builtins, skills, and callable routines for a tenant. The mobile client calls this at chat-session start and injects the result — including the recipe catalog entries — as system context. Different tenants can have different tool inventories; the recipe catalog itself is platform-wide but the invocable agents/tools/skills vary per tenant.

**4. Validator at publish boundary**

`publishRoutineVersion` (`packages/api/src/graphql/resolvers/routines/publishRoutineVersion.mutation.ts`) runs the validator synchronously before touching Step Functions:

```typescript
const validation = await validateRoutineAsl({
  asl: aslJson,
  currentRoutineId: i.routineId,
});
if (!validation.valid) {
  throw new Error(
    validation.errors.map((e) => e.message).join("\n") || "ASL validation failed",
  );
}
```

The validator (`packages/api/src/handlers/routine-asl-validator.ts`) runs a four-stage pipeline:

1. AWS `ValidateStateMachineDefinition` — catches native ASL syntax errors (missing `Next`, malformed Choice rules, unreachable states).
2. Recipe-aware linter — for each state: resolves recipe by `Comment` marker (preferred) or ARN fallback; Ajv-validates the state's `Parameters.Payload` against the recipe's `argSchema`; checks JSONata expression plausibility for `transform_json`/`set_variable`; verifies Resource ARNs are catalog-known.
3. Choice variable field-existence check — warns when a `Variable: $.foo` in a Choice state references a field no prior step demonstrably writes.
4. `routine_invoke` cycle detection — DFS through a caller-supplied call graph plus the current ASL's own `routine_invoke` targets.

The validator returns `{ valid, errors, warnings }` where each entry carries a stable `code`, the offending `stateName`, and a plain-language `message`.

**5. Validator-error feedback loop**

The system prompt explicitly encodes the retry behavior:

```
After you call `publishRoutineVersion`, the server runs the routine ASL
validator. If it returns errors, the chat session feeds the validator
errors back to you as a system message. Address every error and call
`publishRoutineVersion` again with the fixed ASL. **Try at most three
times.** If three attempts fail, reply with: "I'm having trouble building
this routine end-to-end — let's break it into smaller steps."
```

Validator errors surface as system messages; the agent corrects and re-calls the tool. The retry cap prevents infinite correction loops; the fallback message is operator-friendly rather than a raw error dump.

**Two-phase chat flow**

The prompt enforces a `Design → Build` separation. During the design phase the agent sketches steps in plain prose and asks clarifying questions. The build phase is triggered by an explicit operator action ("The user clicked BUILD") — the agent then makes exactly one `publishRoutineVersion` tool call. This prevents partial/speculative publishes during design iteration.

## Why This Matters

**Type safety at the catalog edge.** The validator catches recipe-id typos and arg-shape mismatches before they reach Step Functions. Without it, a malformed `Parameters` block surfaces as an opaque runtime error mid-execution, potentially after a `waitForTaskToken` state has already sent an Inbox card to an operator.

**Observability per step.** Because every state has a known recipe type (stamped in `Comment`), the run-detail UI can render typed step panels — input args, output shape, cost, duration — instead of a single "routine ran" event. The recipe type is the schema key for per-step telemetry. The `hitlCapable: true` flag on `inbox_approval` lets the UI anchor HITL checkpoints specifically.

**Catalog evolution without retraining.** New recipes extend the catalog file and are automatically available to the LLM at the next session because the catalog is injected at session start via `tenantToolInventory`. No prompt rewrite, no fine-tuning, no coordination between the catalog maintainer and the prompt maintainer.

**Operator-readable output.** Recipe ids (`slack_send`, `inbox_approval`, `aurora_query`) are human-meaningful in a way that raw ASL state machine JSON is not. Operators reviewing a routine's step list can understand what it does without reading ARN patterns or JSONata expressions.

**Escape hatch with promotion path.** The `python` recipe provides an unbounded escape hatch. The platform tracks which routines contain `python` steps; over time, popular patterns in `python` steps are candidates for promotion to first-class recipes. The recipe category `escape_hatch` makes this usage visible in aggregate.

**Cycle safety.** The `routine_invoke` recipe's cycle detection runs at publish time against the tenant's full call graph, not just the current routine. A routine can't be published if doing so would create a cycle — catching this in code rather than at execution time prevents hung Step Functions executions.

## When to Apply

- You are letting an LLM emit structured output that another system executes (state machines, SQL queries, infrastructure-as-code, build pipelines, data transformation graphs).
- The downstream consumer benefits from knowing the step type at execution time (per-step retry policies, per-step observability, per-step HITL flags, cost attribution per step type).
- You can enumerate a fixed vocabulary that covers 80–90% of cases. The v0 catalog has 12 recipes; if the vocabulary would need to be hundreds of entries to be useful, the pattern strains — a freeform DSL or code may be the right answer. If it's one or two shapes, the catalog adds overhead for little benefit.
- You have a server-side commit boundary where a validator can run synchronously before the output reaches the runtime. A purely client-side validator that can be bypassed does not provide the same guarantee.
- You want the LLM's output to be auditable by operators who are not engineers, without requiring them to understand the underlying execution substrate.
- The output may evolve over time (new capabilities), and you want to add new shapes without retraining or prompt maintenance.

## Examples

**Before — prompt teaches the LLM the target DSL directly:**

```
# Routine Builder (old)

Write routines as Python code using the thinkwork_sdk:

  from thinkwork_sdk import client, slack, email

  result = client.get("https://api.example.com/data")
  slack.send(channel="#ops", text=f"Got: {result['count']}")

The code field accepts any valid Python. Available SDK modules: client, slack,
email, db, files. Import them at the top of your code block.
```

Result: the LLM emits a `code: string` field containing arbitrary Python. There is no arg schema to check, no step boundary for the runtime to observe, and no structured representation for the UI to render. A misspelled method name surfaces only when the code runs.

**After — prompt teaches the LLM the recipe catalog:**

```
# Routine Builder

You build routines by composing **recipes** — small, well-typed building blocks like
`http_request`, `slack_send`, `agent_invoke`, `python`, and `inbox_approval`.
The exact recipe set + argument schemas for this tenant are injected separately
as the recipe catalog. **Do not invent recipe ids that aren't in the catalog.**

...

After you call `publishRoutineVersion`, the server runs the routine ASL validator.
If it returns errors, the chat session feeds the validator errors back to you as
a system message. Address every error and call `publishRoutineVersion` again with
the fixed ASL. **Try at most three times.**
```

The LLM composes recipe ids and user-authored args. The catalog (12 entries, injected at session start from `tenantToolInventory`) is the schema authority. At publish, the validator Ajv-checks every step's args against the recipe's `argSchema`; a missing `channelId` in a `slack_send` step returns:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "recipe_arg_invalid",
      "message": "State 'NotifyOps' (recipe 'slack_send'): /channelId must have required property 'channelId'",
      "stateName": "NotifyOps"
    }
  ],
  "warnings": []
}
```

This error flows back into the chat session as a system message. The agent corrects the arg and re-calls `publishRoutineVersion`. The fixed routine is accepted, and the version is atomically published to Step Functions with its `live` alias flipped.

**One recipe definition — the `slack_send` shape** (from `packages/api/src/lib/routines/recipe-catalog.ts`):

```typescript
{
  id: "slack_send",
  category: "notification",
  hitlCapable: false,
  argSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      channelId: { type: "string", minLength: 1 },
      text:      { type: "string", minLength: 1 },
      blocks:    { type: "array" },
    },
    required: ["channelId", "text"],
  },
  aslEmitter: (args, ctx) =>
    markRecipe(
      applySequencing(
        {
          Type: "Task",
          Resource: "arn:aws:states:::lambda:invoke",
          Parameters: {
            "FunctionName.$": "$$.Execution.Input.slackSendFunctionName",
            "Payload": {
              channelId: args.channelId,
              text: args.text,
              ...(Array.isArray(args.blocks) ? { blocks: args.blocks } : {}),
            },
          },
          ResultSelector: { "messageTs.$": "$.Payload.messageTs" },
        },
        ctx,
      ),
      "slack_send",
    ),
}
```

The LLM author only ever sees `{ channelId, text, blocks? }`. The ARN, `FunctionName.$` JSONata path, and `ResultSelector` shape are emitter concerns — invisible to the LLM and validated at publish time.

## Related

- [docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md](../architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md) — complementary pattern; the recipe catalog itself was shipped via the inert-to-live seam (catalog + validator merged inert; chat builder + publish flow flipped them live in a second PR).
- [docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md](../../plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md) — master plan that introduced the catalog-as-architecture decision.
- [docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md](../../brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md) — original requirements doc capturing the gap this pattern closes.
