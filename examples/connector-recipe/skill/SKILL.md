---
name: my-connector
description: >
  Send replies back to the external service connected via this connector.
  Use when responding to messages received through the custom connector.
license: MIT
metadata:
  author: thinkwork
  version: "1.0.0"
---

## Tools

- **send_reply** — Send a reply message back to the external service. Takes the `external_thread_id` from thread metadata and the message text to deliver.

## Usage

- When responding to messages from this connector, always use `send_reply` to deliver
  the response back to the external service.
- The thread metadata contains the `connector_id` and `external_thread_id` needed for routing.
- Keep replies concise and formatted appropriately for the external service.
- If `EXTERNAL_API_URL` or `EXTERNAL_API_KEY` is not set, inform the operator rather than silently failing.

## Context

Requires two environment variables on the AgentCore Lambda:
- `EXTERNAL_API_URL` — Base URL of the external service's API
- `EXTERNAL_API_KEY` — Authentication key for the external service

Configure these via the Thinkwork admin panel under Connector Settings.
