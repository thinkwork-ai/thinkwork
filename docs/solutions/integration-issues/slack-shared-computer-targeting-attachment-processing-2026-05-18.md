---
title: Slack shared Computer targeting must use the shared-target resolver before attachment verification
date: 2026-05-18
category: docs/solutions/integration-issues
module: packages/api
problem_type: integration_issue
component: assistant
severity: medium
symptoms:
  - "Linked Slack users could be treated as unlinked when shared Computer targeting was unresolved."
  - "Slack channel ambiguity needed targeting guidance, not the legacy link prompt."
  - "Markdown and XLSX attachment processing needed verification through deployed thread-turn context, not Slack placeholder state."
root_cause: logic_error
resolution_type: code_fix
related_components:
  - packages/api/src/handlers/slack/events.ts
  - packages/api/src/lib/slack/shared-computer-targeting.ts
  - packages/api/src/lib/slack/file-attachments.ts
  - packages/api/src/lib/computers/runtime-api.ts
tags:
  - slack
  - shared-computers
  - attachments
  - xlsx
  - markdown
  - thread-turn-context
---

# Slack shared Computer targeting must use the shared-target resolver before attachment verification

## Problem

Slack event dispatch still used the legacy linked-Computer resolver even after shared Computers became the product model. That flattened shared-channel targeting states into an old linked/unlinked path, so linked Slack users could receive a link prompt when the real problem was missing or ambiguous Computer targeting.

The same verification pass also needed to prove markdown and XLSX attachments through the deployed Computer runtime context path. Slack UI state alone was not enough evidence, because a file can be ingested correctly while the runtime fails later.

## Symptoms

- `packages/api/src/handlers/slack/events.ts` resolved Slack invocations with `loadLinkedSlackComputer`, which only models the older personal-Computer path.
- Shared Computer states such as `missing_target`, `no_assignments`, `unknown_target`, and `missing_prompt` could not be represented by that resolver.
- The handler could respond with a link prompt even when the Slack user was already linked and needed shared Computer targeting guidance.
- Attachment processing had to be checked through `/api/computers/runtime/tasks/:taskId/thread-turn-context`, because Slack placeholders and final response timing can be misleading.

## What Didn't Work

Keeping `loadLinkedSlackComputer` in the event handler did not survive the move from personal Computers to shared Computers. Session history showed the original Slack path was built as `Slack user -> ThinkWork user -> active Computer where owner_user_id = user_id`, which ownerless shared Computers cannot satisfy. (session history)

Treating every unresolved state as an unlinked-user problem was also wrong. Linking answers "who is this Slack user?" Targeting answers "which shared Computer should handle this Slack turn?" Those are different failures and need different Slack responses.

Slack placeholder state was a poor attachment-health signal. Prior live XLSX checks showed ingestion could work while the thread remained on a thinking placeholder because the Computer runtime failed later. The durable proof is whether deployed `thread-turn-context` returns readable attachment content. (session history)

## Solution

Route Slack events through `resolveSlackSharedComputerTarget` and branch on the full targeting result.

```ts
const targetResult = await resolveTarget({
  tenantId: args.workspace.tenantId,
  slackTeamId,
  slackUserId,
  text: slackEventText(event),
  botUserId: args.workspace.botUserId,
});

if (targetResult.status === "unlinked") {
  await slackApi.sendLinkPrompt(...);
  return json({ ok: true, ignored: true, reason: "slack_user_unlinked" });
}

if (targetResult.status !== "resolved") {
  await safePostTargetingGuidance(slackApi, {
    token: args.botToken,
    channel: channelId,
    threadTs: slackThreadTs(event),
    text: slackTargetingGuidance(targetResult),
  });
  return json({
    ok: true,
    ignored: true,
    reason: `slack_target_${targetResult.status}`,
  });
}
```

The default resolver keeps the convenient single-assignment case:

```ts
resolveSlackSharedComputerTarget({
  ...input,
  text: input.text ?? "",
  allowSingleAssignedFallback: true,
});
```

Only the `resolved` path builds the Slack thread-turn input, materializes Slack file references as thread attachments, and enqueues the Computer task using the resolved `userId`, `computerId`, and prompt.

Regression coverage belongs in three places:

- `packages/api/src/handlers/slack/events.test.ts` for the target-state branches and guidance response.
- `packages/api/test/integration/slack-acceptance.test.ts` for acceptance coverage using the shared-target resolver.
- `packages/api/src/lib/slack/file-attachments.test.ts` for Slack XLSX materialization into `thread_attachments` with the correct OOXML MIME type.

## Why This Works

`resolveSlackSharedComputerTarget` preserves the shared Computer state machine instead of reducing it to a nullable linked Computer. The event handler can now distinguish:

```text
unlinked       -> send link prompt
missing target -> post targeting guidance
no assignment  -> post targeting guidance
unknown target -> post targeting guidance
missing prompt -> post targeting guidance
resolved       -> enqueue Computer work
```

That matches the product boundary: Slack account linkage is identity, while shared Computer targeting is routing. The correct routing result also determines which `computerId` and requester `userId` are written into the task payload.

For attachments, the deployed runtime context endpoint proves the full read path:

```text
Slack file ref
  -> materialized thread attachment in S3
  -> message metadata attachment id
  -> loadThreadTurnContext
  -> bounded attachment extraction
  -> runtime-readable contentText
```

This matters because prior attachment work intentionally kept extraction in the Computer thread-turn context path rather than hiding content in Slack-specific ingestion. Session history also noted an earlier XLSX bug where OOXML MIME types include `xml`, so workbook extraction must be explicit and should not depend on generic text/XML detection. (session history)

## Prevention

- Exercise every Slack targeting status in unit tests. Do not assert only "enqueue vs no enqueue"; assert the exact user-facing response path.
- Keep `sendLinkPrompt` reserved for true `unlinked` users. Linked users with unresolved shared Computer routing should receive `slackTargetingGuidance`.
- Verify attachment processing through deployed `thread-turn-context`, not through Slack placeholder text.
- Include both Slack-origin and native chat-origin attachments when checking runtime attachment extraction.
- Treat `.xlsx` as the supported spreadsheet extraction path. Legacy binary `.xls` rows were not present in the dev corpus during this verification and are not covered by the current workbook extractor.

The read-only deployed checks used existing dev tasks:

```text
Slack XLSX task 0ed8cdcf... -> Budget-Forecast.xlsx, readable: true, extractionKind: xlsx
Chat XLSX task 849572ab...  -> Financial Sample.xlsx, readable: true, extractionKind: xlsx
Slack markdown task 71a58579... -> agentic-etl-architecture-v5.md, readable: true, extractionKind: text
```

Local verification completed:

```text
pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/lib/slack/shared-computer-targeting.test.ts src/lib/slack/file-attachments.test.ts src/lib/computers/attachment-extraction.test.ts src/lib/computers/runtime-api.test.ts test/integration/slack-acceptance.test.ts
pnpm --filter @thinkwork/api typecheck
pnpm --filter @thinkwork/api test
git diff --check
```

The remaining caveat from this session: deployed dev rows exercised Slack DM-surface tasks, while shared-channel ambiguity was verified locally through tests rather than a fresh live channel post.

## Related

- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md` - related verification principle: inspect the actual routed runtime path and provider status instead of relying on surface behavior.
- `packages/api/src/handlers/slack/events.ts`
- `packages/api/src/lib/slack/shared-computer-targeting.ts`
- `packages/api/src/lib/slack/file-attachments.ts`
- `packages/api/src/lib/computers/runtime-api.ts`
