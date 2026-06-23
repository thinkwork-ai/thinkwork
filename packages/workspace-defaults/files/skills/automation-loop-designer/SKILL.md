---
name: automation-loop-designer
description: Design a ThinkWork Automation from a prompt by interviewing for goal, Space, trigger, verification, judge settings, stop guards, and privacy boundaries, then emit a reviewable AutomationDraft.
license: MIT
metadata:
  adaptedFrom: https://github.com/ksimback/looper
  adaptedFromLicense: MIT
  adaptedFromAuthor: Kevin Simback
---

# Automation Loop Designer

Use this skill when a user wants to create, improve, or review a ThinkWork
Automation. The output is a reviewable `AutomationDraft` for ThinkWork's durable
Automation runtime. Do not emit a Looper Python runner, Claude slash command,
or file-scaffolded external loop unless the user explicitly asks for a separate
portable design artifact.

This skill adapts design-coaching ideas from Kevin Simback's Looper
(`https://github.com/ksimback/looper`, MIT license): coached goals, typed
verification, review gates, stop guards, state/logging visibility, and explicit
privacy boundaries. ThinkWork remains the orchestrator.

## Interview Flow

Ask only the questions needed to make the draft reviewable. Prefer one compact
question at a time when the user's intent is unclear.

1. Goal: what outcome should exist after each run?
2. Space: where should the execution thread live?
3. Trigger: manual, schedule, API, webhook, app event, or future workflow.
4. Verification: what evidence proves the run is good enough?
5. Judge: self-check, human approval, model judge, reviewer agent, eval
   threshold, or external callback.
6. Control: max iterations, runtime/token/budget caps, no-progress stops, and
   failure behavior.
7. Privacy: which external systems or humans may see the prompt, evidence, or
   review context.

## Design Rules

- Treat the user's prompt as the Automation's main artifact. Do not bury it
  behind internal AgentLoop jargon.
- If a crisp done state exists, write concrete `goal.completionCriteria` and
  matching `judge.criteria`.
- If the goal is useful but not yet crisply checkable, set
  `source.goalInference` to `runtime_inferred` and include a plain-language
  note about what should be clarified later.
- Prefer programmatic checks when the Automation naturally has measurable
  outputs. Use judge or human checks for qualitative work.
- Keep reviewer and judge roles distinct. A reviewer gives notes; a judge
  returns a verdict.
- Require at least two stop guards for recurring work: an iteration/runtime cap
  and a no-progress or budget stop.
- Name the execution boundary. For ThinkWork v1 this is usually one selected
  Space plus a first-class thread created by the Automation run.
- Do not ask the user to select a worker agent in v1. Use the main ThinkWork
  Agent unless an operator is in Advanced mode.

## AutomationDraft Shape

Return a JSON object with this shape when the user is ready to review:

```json
{
  "name": "Readable Automation name",
  "prompt": "The instruction the Automation will run",
  "space": {
    "id": "selected-space-id-or-null",
    "name": "selected Space name or requested Space"
  },
  "trigger": {
    "family": "manual",
    "scheduleExpression": null,
    "timezone": "UTC"
  },
  "goal": {
    "objective": "Normalized objective",
    "completionCriteria": ["Concrete criterion, if known"]
  },
  "judge": {
    "mode": "self_check",
    "criteria": ["Criterion the judge can inspect"]
  },
  "policy": {
    "maxIterations": 1,
    "maxRuntimeMinutes": 30,
    "maxTokens": 100000,
    "failBehavior": "return_blocker"
  },
  "source": {
    "creationMode": "chat",
    "goalInference": "explicit",
    "designerSkill": "automation-loop-designer"
  }
}
```

If the draft uses runtime-inferred criteria, keep the Automation valid by
including a fallback completion criterion in the review summary:

```text
The agent produces a useful response or next step for the automation prompt.
```

## Review Summary

Before the Automation is saved, summarize:

- Prompt
- Space
- Trigger
- Done condition or runtime-inferred fallback
- Judge mode
- Stop guards
- Privacy or external context notes

Ask for explicit confirmation before save. After confirmation, the host system
will persist the draft through ThinkWork's Automation save path and link this
builder thread as setup history.
