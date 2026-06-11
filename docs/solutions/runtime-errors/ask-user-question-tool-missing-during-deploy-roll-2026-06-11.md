---
title: "Agent asks questions in prose instead of calling ask_user_question — turns racing a deploy lose extension registration"
date: 2026-06-11
category: docs/solutions/runtime-errors/
module: packages/agentcore-pi
problem_type: runtime_error
component: pi_extensions
severity: medium
applies_when:
  - The agent writes clarifying questions as a markdown list instead of producing a question card
  - tools_called is empty but the system prompt contains the ask_user_question policy block
  - Verifying any extension-gated tool right after a merge/deploy
tags: [ask-user-question, pi-extensions, deploy-race, agentcore, hitl]
---

# Agent asks in prose instead of calling ask_user_question during deploy rolls

## Symptom

Threads created in a narrow window showed the model writing its clarifying
questions as a prose/markdown list — no question card, no
`pending_user_questions` row, thread not parked AWAITING_USER. The same
prompt minutes later produced a proper card.

## Root cause

The turns started in the same minute the Deploy was rolling the runtime
(Lambda code update + ~20 AgentCore container reboots in the log window).
The `ask_user_question` extension registers only when the invoke payload
carries `thinkwork_api_url`, `thinkwork_api_secret`, and `thread_turn_id`
(server.ts gate); mid-roll those aren't wired yet, the gate silently skips
registration, the model never sees the tool, and it falls back to asking in
text. Same family as the known AgentCore deploy race that strands env vars.

## How to tell this apart from a real regression

1. `select usage_json->'tools_called'` for the turn — empty, AND
2. `position('ask_user_question' in system_prompt) > 0` — the policy block IS
   present (so prompt composition is fine), AND
3. `aws lambda get-function-configuration ... --query LastModified` is within
   ~a minute of the turn's `started_at`, and/or the AgentCore runtime log
   group shows a burst of `server_listening` events in the window.

If all three hold: deploy race. Re-test on a fresh thread after the deploy
settles before touching any code. (Verified 2026-06-11: post-settle thread
called the tool and parked with 4 pending questions.)

## Notes

- The chat-agent-invoke phase logs live in
  `/aws/lambda/thinkwork-dev-api-chat-agent-invoke`; the Pi Lambda's
  configured log group is `/thinkwork/dev/agentcore-pi` (LoggingConfig), and
  AgentCore container boot logs are in
  `/aws/bedrock-agentcore/runtimes/thinkwork_dev_pi-*-DEFAULT`.
- Kimi K2.5 separately leaks tool calls as literal `<tool_call>` text even
  when the tool IS registered — that's the leaked-tool-call rescue in
  `packages/agentcore-pi/agent-container/src/ask-user-question-rescue.ts`,
  a different failure with a different signature (token soup vs clean prose).
