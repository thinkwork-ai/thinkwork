---
title: Slack Data Handling
description: "Privacy and compliance disclosure for the ThinkWork Slack workspace app."
---

This page describes what the ThinkWork Slack workspace app processes, where that data is stored, and how operators can explain the integration to enterprise IT and compliance reviewers.

## Processing scope

ThinkWork processes Slack data only when a user invokes the app through a supported Slack surface:

- `@ThinkWork` mention
- direct message to the ThinkWork bot
- `/thinkwork` slash command
- message shortcut
- **Post to channel** promotion on an already-generated ephemeral response

The app does not continuously ingest workspace history. It does not index all Slack channels. It does not train models on Slack content.

## Data sent into a Computer turn

For an invoked turn, ThinkWork builds a Slack task envelope containing:

| Data                                    | Purpose                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Slack team id and workspace row id      | Resolve the installed tenant workspace and bot token.                                                    |
| Slack channel id and thread timestamp   | Preserve where the response should return.                                                               |
| Invoking Slack user id                  | Resolve the linked ThinkWork user and Computer.                                                          |
| Source message text and timestamp       | Give the Computer the user's actual request.                                                             |
| Summarized source-thread messages       | Provide relevant local context for the request.                                                          |
| File references from the source message | Let the Computer reason about attachments the user explicitly included.                                  |
| Slack delivery metadata                 | Store `response_url`, placeholder timestamp, or modal id so the dispatcher can deliver the final answer. |

Messages outside the invoked thread are not included. If thread fetch fails, the task still proceeds with the source message and an empty thread context.

## Storage

ThinkWork stores Slack integration state in the customer's AWS account:

- `slack_workspaces`: workspace install metadata, bot user id, status, and Secrets Manager path.
- `slack_user_links`: per-user Slack-to-ThinkWork account bindings.
- `slack_threads`: Slack-to-ThinkWork thread/message mapping.
- `computer_tasks`: the normalized Computer task envelope and response state.
- `computer_events`: dispatch, failure, and attribution-degradation events.
- Secrets Manager: Slack app credentials and per-workspace bot tokens.

Slack bot tokens are not committed to the repo or stored in Terraform variables. Lambda environment variables contain secret ARNs/paths, not token values.

## Model and runtime use

Slack content enters the same tenant-scoped Computer runtime as ordinary ThinkWork thread turns. The runtime can use the user's assigned Computer memory, Company Brain context, and approved tools under the same tenant and user boundaries that apply outside Slack.

Slack content is not used to train foundation models. Provider-specific retention and no-training controls follow the deployed Bedrock/AgentCore configuration for the customer's AWS account.

## Residency and account boundary

ThinkWork is AWS-native. The Slack app, task storage, runtime, and dispatch path run in the customer's configured AWS region and account. For current deployments, ThinkWork operators should describe the Slack app as US-region processing unless the stage has been explicitly provisioned elsewhere.

Slack itself may process and store Slack workspace data under the customer's Slack agreement. ThinkWork's disclosure covers only the data after Slack sends an invocation to the ThinkWork app endpoint.

## Access controls

- Workspace installation is tenant-admin controlled.
- User linking is per-user; an admin workspace install does not automatically let every Slack user invoke a Computer.
- Runtime task creation uses the linked ThinkWork user id, not the Slack display name alone.
- The Slack dispatcher reads the bot token only from the tenant-scoped Secrets Manager path associated with the installed workspace.

## Deletion and revocation

Uninstalling the Slack app or revoking the bot token prevents new Slack delivery. Existing audit and Computer task records remain for traceability according to the customer's retention policy. Operators can mark a workspace revoked and ask users to re-install/re-link when Slack returns authentication errors.

## Compliance reviewer summary

ThinkWork's Slack app is an on-demand invocation surface. It processes only messages a user explicitly invokes from, stores tokens in Secrets Manager, routes work through tenant-scoped Computer tasks, and preserves attribution in Slack even when optional identity customization is unavailable.
