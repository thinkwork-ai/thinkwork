---
title: Slack Workspace App
description: "Install ThinkWork in Slack, link Slack users to Computers, and understand scopes, attribution, and supported Slack surfaces."
---

The Slack workspace app lets people work with their ThinkWork Computer from Slack without turning Slack into a separate agent runtime. Slack is an ingress and delivery surface: messages are verified, mapped to the right tenant workspace and linked user, queued as Computer thread turns, and answered back in Slack with explicit attribution.

## What the app does

- Handles `@ThinkWork` mentions in channels and direct messages to the bot.
- Handles `/thinkwork <prompt>` slash commands.
- Handles message shortcuts for asking a Computer to work from a specific Slack message or thread.
- Preserves Slack thread context and supported file references in the Computer task envelope.
- Returns an immediate Slack acknowledgement, then delivers the completed Computer response through a placeholder update, modal update, `response_url`, or threaded message.
- Shows who the answer is routed through with an always-on footer: `Routed via @ThinkWork · <user>'s Computer`.

## Install and linking model

An admin installs the Slack app for a workspace from ThinkWork admin. The install stores the workspace bot token in AWS Secrets Manager under a tenant-scoped path. End users then link their own Slack identity from the mobile connection flow or Slack App Home, which creates a `slack_user_links` row from Slack user id to ThinkWork user id and Computer id.

The app is workspace-scoped in v1. Enterprise Grid customers can install ThinkWork separately into each workspace that needs it.

## Supported surfaces

| Slack surface    | User action                                      | Slack response behavior                                                                                         |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Channel mention  | `@ThinkWork summarize this thread`               | A placeholder is posted in-thread, then updated with the Computer response.                                     |
| Direct message   | Message the ThinkWork bot                        | The Computer response is posted back in the DM.                                                                 |
| Slash command    | `/thinkwork what changed this week?`             | Slack receives an empty 200 ack; the answer is sent as an ephemeral response with a **Post to channel** button. |
| Message shortcut | Use the ThinkWork shortcut on a message          | A working modal opens immediately, then the modal updates and the answer is posted in the source thread.        |
| Public promotion | Click **Post to channel** on an ephemeral answer | The response is posted publicly with attribution; the ephemeral source is deleted after the post succeeds.      |

## Slack scopes

The app requests the minimum bot and OAuth scopes needed for the supported surfaces. Scope names may vary slightly as Slack evolves, but v1 expects:

| Scope                                                              | Why ThinkWork needs it                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `app_mentions:read`                                                | Receive `@ThinkWork` mentions.                                                            |
| `channels:history`, `groups:history`, `im:history`, `mpim:history` | Read the source thread context that the user explicitly invoked from.                     |
| `chat:write`                                                       | Post placeholders, final responses, link prompts, and promoted public messages.           |
| `commands`                                                         | Receive `/thinkwork` slash commands.                                                      |
| `files:read`                                                       | Reference files attached to invoked Slack messages.                                       |
| `im:write`                                                         | Send connection prompts when a Slack user is not linked yet.                              |
| `users:read`                                                       | Resolve display names and avatar metadata for attribution.                                |
| `users:read.email`                                                 | Match Slack users to ThinkWork users during linking.                                      |
| `chat:write.customize`                                             | Optional. Lets ThinkWork render a response as `<user>'s Computer` with the user's avatar. |

### Why `chat:write.customize` is optional

ThinkWork uses `chat:write.customize` only for clearer attribution in shared channels. Some enterprise IT teams remove or reject that scope because it allows a bot to customize message identity. The Slack app still works without it: the dispatcher retries with the plain bot identity, prefixes the message body with the Computer name, keeps the attribution footer, and emits the `slack.attribution.degraded` metric for operators.

## Unlinked users

If a Slack user invokes ThinkWork before linking their identity, ThinkWork does not create Computer work. The app posts a short connection prompt and publishes the App Home connect action. After the user links Slack to ThinkWork, the same Slack surface proceeds normally.

## Data sent to the Computer

ThinkWork sends only the invoked Slack context needed for the turn: Slack team id, channel id, invoking Slack user id, source message, summarized messages from the source thread, and referenced file metadata. Messages outside the invoked thread are not included.

For the formal disclosure, see [Slack data handling](/compliance/slack-data-handling/).

## Operations

The runtime emits CloudWatch EMF metrics for Slack ingress, dedupe, unknown teams, dispatch success/failure, and attribution degradation. Operators should start with the [Slack dispatch runbook](/operations/slack-dispatch-runbook/) when a Slack alarm fires.
