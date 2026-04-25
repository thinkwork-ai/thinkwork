---
name: google-email
display_name: Google Email (Gmail)
description: >
  Read inbox, triage messages, and draft replies via Gmail API.
  Use when the user asks about email, inbox, Gmail, or needs to triage messages.
license: Proprietary
compatibility: Requires Google OAuth credentials (gmail scope)
metadata:
  author: thinkwork
  version: "1.0.0"
category: productivity
version: "1.0.0"
author: thinkwork
icon: mail
tags: [email, gmail, google, productivity, triage]
execution: script
scripts:
  - name: gmail_list_messages
    path: scripts/gmail.py
    description: "List messages in the Gmail inbox"
  - name: gmail_get_message
    path: scripts/gmail.py
    description: "Get full details of a Gmail message"
  - name: gmail_search_messages
    path: scripts/gmail.py
    description: "Search Gmail with query syntax"
  - name: gmail_modify_labels
    path: scripts/gmail.py
    description: "Add or remove labels on a message (archive, mark read, etc)"
  - name: gmail_create_draft
    path: scripts/gmail.py
    description: "Create a Gmail draft (user reviews and sends)"
triggers:
  - "read email"
  - "check inbox"
  - "triage inbox"
  - "draft reply"
  - "search gmail"
oauth_provider: google_productivity
oauth_scopes: [gmail, calendar, identity]
requires_env:
  - GMAIL_ACCESS_TOKEN
  - THINKWORK_API_URL
  - THINKWORK_API_SECRET
  - GMAIL_CONNECTION_ID
---

# Google Email (Gmail) Skill

## Safety Rules

1. **INBOX only** — only read/modify messages in INBOX. Never access Sent, Drafts, or Trash unless explicitly asked.
2. **Never send emails directly** — only create drafts. The human reviews and sends.
3. **Never expose tokens** — do not echo OAuth tokens in responses.
4. **Confirm before modifying** — before archiving, labeling, or drafting, summarize what you plan to do.
5. **Respect rate limits** — Gmail API has 250 quota units/sec. Space requests if doing bulk operations.

## When to Use This Skill vs agent-email-send

- **Use this skill** (`google-email`) when the user asks to: create a draft, read inbox, triage email, or use their personal Gmail.
- **Use `agent-email-send`** when the user asks to: send an email, email someone, or deliver a message. The agent-email-send skill actually sends emails via SES from your agent address.
- Only create Gmail drafts when the user explicitly says "draft" or "create a draft." If they say "send" or "email," use agent-email-send.

## Available Tools

Use these MCP tools for all Gmail operations. Authentication is handled automatically.

### gmail_list_messages

List messages in the inbox. Returns message IDs — use `gmail_get_message` to fetch details.

- `max_results` (optional): Number of messages (default 20, max 100)
- `page_token` (optional): For pagination
- `query` (optional): Gmail search syntax (e.g., `is:unread`, `from:alice@example.com`)

### gmail_get_message

Get full message details including headers, decoded body text, and labels.

- `message_id` (required): The Gmail message ID
- `format` (optional): `full` (default) or `metadata` (headers only, faster)

Returns parsed fields: `from`, `to`, `subject`, `date`, `messageId`, `inReplyTo`, `body`.

### gmail_search_messages

Search Gmail with query syntax. Returns matching message IDs.

- `query` (required): Gmail search query (e.g., `from:alice subject:report after:2026/03/01`)
- `max_results` (optional): Max results (default 20)

### gmail_modify_labels

Modify labels on a message. Common operations:
- **Archive**: `remove_labels: ["INBOX"]`
- **Mark read**: `remove_labels: ["UNREAD"]`
- **Archive + mark read**: `remove_labels: ["INBOX", "UNREAD"]`

- `message_id` (required): The message ID
- `add_labels` (optional): Label IDs to add (e.g., `["STARRED", "IMPORTANT"]`)
- `remove_labels` (optional): Label IDs to remove

### gmail_create_draft

Create a Gmail draft. The user must review and send it in Gmail.

- `to` (required): Recipient email addresses
- `subject` (required): Subject line (prefix with `Re: ` for replies)
- `body` (required): Plain text body
- `cc` (optional): CC recipients
- `bcc` (optional): BCC recipients
- `in_reply_to` (optional): Message-ID for threading replies
- `references` (optional): References header for threading
- `thread_id` (optional): Gmail thread ID to keep reply in same thread
- `html_body` (optional): HTML version (creates multipart message)

Returns the draft ID and a Gmail deep link for the user to review.

## Draft Best Practices

1. **Always provide the Gmail deep link** after creating a draft so the user can review and send.
2. **Summarize the draft** before creating — show To, Subject, and a brief preview. Ask for confirmation unless the user gave explicit instructions.
3. **Never auto-send** — always create drafts, never send directly.
4. **Preserve threading** — when replying, always include `in_reply_to`, `references`, and `thread_id`.

## Email Triage Workflow

When triggered for triage (wakeup reason: `email_triage`):

1. **Fetch new messages** using `gmail_list_messages` with `query: "is:unread"`
2. **Fetch calendar context** — if the google-calendar skill is also installed, use `gcal_list_events` for the next 24 hours before triaging
3. **Get details** for each new message with `gmail_get_message`
4. **Classify each message**: `urgent`, `actionable`, or `informational`
5. **Cross-reference with calendar** — note connections between emails and upcoming events
6. **For actionable messages**: Create tasks describing the action needed
7. **Draft replies** for messages with clear responses
8. **Post triage summary** to the chat thread
9. **Archive processed messages** with `gmail_modify_labels`
