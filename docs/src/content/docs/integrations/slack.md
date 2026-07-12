---
title: Slack Workspace App
description: "Mention or DM the ThinkWork bot in Slack to run a turn as your linked ThinkWork user, with the final response delivered back to the originating thread."
---

:::note[Internal dogfood]
The Slack workspace app is deployed and functional for mentions and direct messages. It is currently in internal dogfood (THINK-84); distribution beyond internal workspaces is an operational follow-up.
:::

The Slack workspace app lets people work with the tenant platform agent from Slack without turning Slack into a separate agent runtime. Slack is an ingress and delivery surface: events are signature-verified, mapped to the installed tenant workspace and the explicitly linked ThinkWork user, persisted as ordinary ThinkWork thread messages in the general Space, executed by the platform agent, and answered back in the originating Slack thread.

ThinkWork remains the system of record. The transport edge uses pinned low-level Chat SDK Slack primitives (`@chat-adapter/slack`) for verification, payload parsing, and Web API calls only; no provider object becomes ThinkWork state, and the workspace bot token is transport-only.

## Supported surfaces

| Slack surface              | User action                                       | Behavior                                                                                                                        |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Channel mention            | `@ThinkWork summarize this thread`                | A brief acknowledgement is posted in-thread; the finalized agent response is posted to the same thread when the turn completes. |
| Direct message             | `draft a customer update`                         | Same loop in the bot DM — no mention token required.                                                                            |
| Threaded channel follow-up | Reply in the thread **and mention the bot again** | Continues the same ThinkWork thread; the response returns to the same Slack thread.                                             |

In channels, every invocation requires an explicit `@ThinkWork` mention — a plain thread reply without a mention is not received or processed. Only bot DMs work without a mention.

Slash commands, message shortcuts, modals, and interactive components are **not supported**. Their endpoints were removed rather than left accepting and dropping requests. If a workspace's Slack app configuration still registers a `/thinkwork` slash command or an interactivity request URL from an earlier install, remove them in the Slack app settings — those requests now receive a 404 (Slack shows `dispatch_failed` for the command).

## Install and linking model

An admin installs the Slack app for a workspace from ThinkWork admin (`GET /slack/oauth/install` with signed, expiring state). The install stores the workspace bot token in AWS Secrets Manager under a tenant-scoped path and upserts a `slack_workspaces` row.

End users then link their own Slack identity explicitly (mobile connection flow), creating a `slack_user_links` row from Slack user id to ThinkWork user id. **There is no email-based auto-linking.** An unlinked user who invokes the bot receives a link prompt and no work is executed.

Every turn executes as the linked ThinkWork user — never as the bot or workspace identity.

## Event subscriptions

The app requires these Events API subscriptions:

- `app_mention` — channel mentions
- `message.im` — direct messages to the bot
- `message.channels` (and `message.groups` for private channels) — required for mentions on messages with file attachments: Slack delivers those as `message` events with subtype `file_share` instead of `app_mention`, and ThinkWork promotes ones whose text mentions the bot. All other channel messages are acknowledged no-ops.

## Slack scopes

The install flow requests the minimum bot scopes for the shipped surfaces — every scope maps to an event subscription or Web API call the code actually makes:

| Scope                                                              | Why ThinkWork needs it                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `app_mentions:read`                                                | Receive `@ThinkWork` mentions.                                                                              |
| `channels:history`, `groups:history`, `im:history`, `mpim:history` | Receive DM and file-attachment message events, and read bounded thread context via `conversations.replies`. |
| `chat:write`                                                       | Post acknowledgements, final responses, and link prompts.                                                   |
| `files:read`                                                       | Download files attached to invoked Slack messages.                                                          |

No other scopes are requested. In particular, `commands`, `chat:write.customize`, and `users:read.email` belong to removed or forbidden behaviors (slash commands, customized attribution, email auto-linking), and metadata-read scopes (`channels:read` etc.), `im:write`, and `users:read` were dropped because no code path uses them — the unlinked-user prompt is posted into the originating conversation with `chat:write`, not via a newly opened DM.

Slack does not revoke previously granted scopes: a workspace installed before a scope trim keeps its broader grant until the app is reinstalled. Reinstall through ThinkWork admin to converge an existing workspace onto the minimum set.

## Reliability semantics

- **Idempotent ingress** — every accepted event stores a provider-prefixed source event id on the message row behind a tenant-scoped unique index. Slack redeliveries (with or without retry headers) reuse the existing message and never create a duplicate turn.
- **Exactly-once replies** — final delivery is claimed and recorded per assistant message (`metadata.slackDelivery`); retries redrive failures without double-posting.
- **Origin-gated delivery** — a web or mobile follow-up on a Slack-created thread never posts back to Slack; only turns triggered by a Slack-originated message deliver externally.
- **Fail-visible delivery** — a Slack API failure is persisted and retryable; it never rolls back the assistant message or the turn.

## Data sent to the agent

ThinkWork sends only the invoked Slack context needed for the turn: team id, channel id, invoking Slack user id, linked requester ThinkWork user id, source message, bounded messages from the source thread, and referenced file metadata. Messages outside the invoked thread are not included. Completed turns follow the ordinary Hindsight memory and Wiki processing paths.

For the formal disclosure, see [Slack data handling](/compliance/slack-data-handling/).

## Operations

The runtime emits CloudWatch EMF metrics for Slack ingress latency, dedupe hits, unknown teams, and dispatch success/failure in the `ThinkWork/Slack` namespace. Operators should start with the [Slack operations runbook](/operations/slack-dispatch-runbook/) when a Slack alarm fires.
