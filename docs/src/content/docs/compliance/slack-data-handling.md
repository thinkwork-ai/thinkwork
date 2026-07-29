---
title: Slack Data Handling
description: "Privacy and compliance disclosure for the ThinkWork Slack workspace app."
---

This page describes what the ThinkWork Slack workspace app processes, where that data is stored, and how operators can explain the integration to enterprise IT and compliance reviewers.

## Processing scope

ThinkWork processes Slack data only when a user invokes the app through a supported Slack surface:

- `@ThinkWork` mention in a channel (including a mention in a thread reply — channel invocations always require an explicit mention)
- direct message to the ThinkWork bot

A channel message that does not mention the bot is not processed, even in a thread the bot previously answered in. Slash commands, message shortcuts, modals, and interactive components are not supported and their endpoints do not exist.

Note on scopes: the install flow requests only the minimum bot scopes for these surfaces. Slack does not retroactively revoke scopes, so a workspace installed under an earlier, broader scope set retains those grants until the app is reinstalled.

The app does not continuously ingest workspace history. It does not index all Slack channels. It does not train models on Slack content.

## Data processed for an invoked turn

For an invoked turn, ThinkWork persists an ordinary ThinkWork thread message with Slack provenance:

| Data                                    | Purpose                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Slack team id and workspace row id      | Resolve the installed tenant workspace and bot token.                                    |
| Slack channel id and thread timestamp   | Map the conversation to one ThinkWork thread and return the response to the right place. |
| Slack event id                          | Deduplicate Slack redeliveries (one message and one turn per event).                     |
| Invoking Slack user id                  | Resolve the explicitly linked ThinkWork requester.                                       |
| Source message text and timestamp       | Give the agent the user's actual request.                                                |
| Bounded source-thread messages          | Provide relevant local context for the request.                                          |
| File references from the source message | Let the agent reason about attachments the user explicitly included.                     |

Messages outside the invoked thread are not included. If thread-context fetch fails, the turn still proceeds with the source message alone.

## Storage

ThinkWork stores Slack integration state in the customer's AWS account:

- `slack_workspaces`: workspace install metadata, bot user id, status, and Secrets Manager path.
- `slack_user_links`: per-user Slack-to-ThinkWork account bindings (explicit linking only; no email-based matching).
- `slack_threads`: Slack-to-ThinkWork thread mapping.
- `messages` / `threads`: the ordinary ThinkWork conversation records, including the Slack source event id and per-message delivery evidence.
- Secrets Manager: Slack app credentials and per-workspace bot tokens.

Slack bot tokens are not committed to the repo or stored in Terraform variables. Lambda environment variables contain secret ARNs/paths, not token values.

## Model and runtime use

Slack content enters the same tenant-scoped agent runtime as ordinary ThinkWork thread turns, executing as the linked ThinkWork user under the same tenant and user boundaries that apply outside Slack. Completed turns follow the ordinary AgentCore memory and Wiki processing paths.

Slack content is not used to train foundation models. Provider-specific retention and no-training controls follow the deployed Bedrock/AgentCore configuration for the customer's AWS account.

## Residency and account boundary

ThinkWork is AWS-native. The Slack ingress, storage, runtime, and reply delivery run in the customer's configured AWS region and account. For current deployments, ThinkWork operators should describe the Slack app as US-region processing unless the stage has been explicitly provisioned elsewhere.

Slack itself may process and store Slack workspace data under the customer's Slack agreement. ThinkWork's disclosure covers only the data after Slack sends an invocation to the ThinkWork app endpoint.

## Access controls

- Workspace installation is tenant-admin controlled.
- User linking is per-user and explicit; an admin workspace install does not automatically let every Slack user execute work. Unlinked users receive a link prompt and no turn runs.
- Every turn executes as the linked ThinkWork user — never as the bot or workspace identity.
- The reply path reads the bot token only from the tenant-scoped Secrets Manager path associated with the installed workspace, and only to post to the originating conversation.

## Deletion and revocation

Uninstalling the Slack app or revoking the bot token prevents new Slack ingress and delivery. Existing ThinkWork conversation and audit records remain for traceability according to the customer's retention policy. Operators can mark a workspace revoked and ask users to re-install/re-link when Slack returns authentication errors.

## Compliance reviewer summary

ThinkWork's Slack app is an on-demand invocation surface. It processes only messages a user explicitly invokes from, stores tokens in Secrets Manager, executes work as the explicitly linked ThinkWork user through ordinary tenant-scoped threads, and delivers exactly one final response back to the originating Slack conversation.
