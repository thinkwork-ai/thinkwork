---
name: agent-email-send
description: >
  Send emails from your agent email address with reply tracking.
  Use when the agent needs to send an email, reply to a message, or follow up with someone.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Agent Email Send Skill

## Safety Rules

1. **Max 5 recipients** — never send to more than 5 email addresses in a single message.
2. **Max 10 emails per hour** — pace outbound emails to avoid spamming.
3. **Never expose secrets** — do not echo `$MANIFLOW_API_SECRET` or internal tokens in responses.
4. **Confirm before sending** — summarize the recipient, subject, and key points before sending unless the user explicitly said to send immediately.
5. **Professional tone** — emails are sent from your official agent address. Maintain a professional, clear tone.
6. **No attachments** — this skill sends plain text emails only. Do not promise or attempt to attach files.

## Your Email Address

Your email address is `$AGENT_EMAIL_ADDRESS`. All outbound emails are sent from this address. Recipients can reply directly to this address.

## Sending an Email

Use the `send_email` tool to send emails. You MUST always include your `agent_id` and `agent_email_address` from your configuration:

- **agent_id**: `$AGENT_ID`
- **agent_email_address**: `$AGENT_EMAIL_ADDRESS`

**Important:** The `agent_id` must be the UUID value from `$AGENT_ID`, not a slug or name.

### Parameters

| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | Yes | Your agent ID (`$AGENT_ID`) |
| `to` | Yes | Recipient email address(es), comma-separated for multiple |
| `subject` | Yes | Email subject line |
| `body` | Yes | Plain text email body (your reply only — quoted thread is appended automatically) |
| `threadId` | No | Thread ID to associate replies with a specific conversation |
| `inReplyTo` | No | Message-ID of the email being replied to (for threading). Use `$INBOUND_MESSAGE_ID` when replying to an inbound email. |
| `quotedFrom` | No | Sender of the original email (for quoting). Use `$INBOUND_FROM` when replying. |
| `quotedBody` | No | Body of the original email (for quoting). Use `$INBOUND_BODY` when replying. |

### Response

```json
{
  "messageId": "ses-message-id",
  "status": "sent"
}
```

## Reply Tracking

When you send an email, a cryptographic reply token is automatically embedded in the email headers. When the recipient replies, their reply is automatically routed back to you through the email channel — even if they are not on your allowlist.

Reply tokens expire after 7 days and allow up to 3 replies per token.

## Email Threading (REQUIRED for replies)

**MANDATORY:** When responding to an inbound email, you MUST include ALL of these fields. Omitting them causes the reply to arrive as a separate email instead of a threaded reply, which is a broken user experience.

- `"inReplyTo": "${INBOUND_MESSAGE_ID}"` — **REQUIRED** — threads the reply in the same conversation
- `"quotedFrom": "${INBOUND_FROM}"` — **REQUIRED** — identifies the original sender in the quote
- `"quotedBody": "${INBOUND_BODY}"` — **REQUIRED** — the original message (auto-quoted with `>` prefixes below your reply)
- `"subject": "Re: ${INBOUND_SUBJECT}"` — **REQUIRED** — prefix with "Re: " if not already prefixed

The server automatically formats the quoted thread — your `body` should only contain your reply. Do not manually quote the original message.

## When to Use This Skill

- Responding to inbound emails you received
- Proactively reaching out to contacts when instructed
- Sending status updates, reports, or summaries via email
- Following up on tasks or requests

## When NOT to Use This Skill

- If the user explicitly asks to **create a draft** in their Gmail — use the `google-email` skill instead.
- If the user asks to **use their personal email** — use the `google-email` skill to create a draft they can review and send themselves.

## Example Workflow

1. You receive an email via `email_received` wakeup
2. Process the request in the email body
3. Use this skill to send a reply with results
4. The recipient can reply back, continuing the conversation
