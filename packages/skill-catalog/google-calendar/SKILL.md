---
name: google-calendar
display_name: Google Calendar
description: >
  Read events, check availability, and create tentative events via Google Calendar API.
  Use when the user asks about their calendar, scheduling meetings, or checking availability.
license: Proprietary
compatibility: Requires Google OAuth credentials (calendar scope)
metadata:
  author: thinkwork
  version: "1.0.0"
category: productivity
version: "1.0.0"
author: thinkwork
icon: calendar
tags: [calendar, google, productivity, scheduling]
execution: script
scripts:
  - name: gcal_list_events
    path: scripts/gcal.py
    description: "List calendar events in a time range"
  - name: gcal_get_event
    path: scripts/gcal.py
    description: "Get full details of a calendar event"
  - name: gcal_check_availability
    path: scripts/gcal.py
    description: "Check free/busy status for a time range"
  - name: gcal_create_event
    path: scripts/gcal.py
    description: "Create a tentative calendar event"
  - name: gcal_update_event
    path: scripts/gcal.py
    description: "Update or confirm a calendar event"
  - name: gcal_delete_event
    path: scripts/gcal.py
    description: "Delete a calendar event"
triggers:
  - "check calendar"
  - "schedule meeting"
  - "check availability"
  - "create event"
  - "upcoming events"
oauth_provider: google_productivity
oauth_scopes: [gmail, calendar, identity]
requires_env:
  - GCAL_ACCESS_TOKEN
  - THINKWORK_API_URL
  - THINKWORK_API_SECRET
  - GCAL_CONNECTION_ID
---

# Google Calendar Skill

## Safety Rules

1. **Read-only by default** — only read events and check availability. Event creation requires explicit user request.
2. **Never expose tokens** — do not echo OAuth tokens in responses.
3. **Confirm before creating** — before creating or modifying events, summarize details and ask for confirmation.
4. **Respect rate limits** — Calendar API has 500 requests/100 seconds.
5. **Always create events as tentative first** — new events must use `status: "tentative"`. Only confirm after explicit user approval.

## Available Tools

Use these MCP tools for all Calendar operations. Authentication is handled automatically.

### gcal_list_events

List events within a time range from the user's primary calendar.

- `time_min` (required): Start of range in ISO 8601 (e.g., `2026-03-23T00:00:00Z`)
- `time_max` (required): End of range in ISO 8601
- `max_results` (optional): Max events (default 50)

**Common time ranges:**
- Today: `time_min=2026-03-23T00:00:00Z, time_max=2026-03-23T23:59:59Z`
- Next 24 hours: `time_min={now}, time_max={now+24h}`
- This week: `time_min={monday}, time_max={sunday}`

### gcal_get_event

Get full details of a single event.

- `event_id` (required): The Calendar event ID

### gcal_check_availability

Check free/busy status for a time range. Use before creating events to avoid conflicts.

- `time_min` (required): Start in ISO 8601
- `time_max` (required): End in ISO 8601

### gcal_create_event

Create a new calendar event. Events are always created as **tentative** — the user must confirm.

- `summary` (required): Event title
- `start` (required): Start time in ISO 8601, or date for all-day (e.g., `2026-03-24`)
- `end` (required): End time, or next day for all-day events
- `description` (optional): Event notes
- `location` (optional): Event location
- `attendees` (optional): Attendee email addresses
- `timezone` (optional): Timezone (e.g., `America/Chicago`)
- `recurrence` (optional): RRULE string (e.g., `RRULE:FREQ=WEEKLY;COUNT=4`)
- `create_meet` (optional): If true, attach a Google Meet link

### gcal_update_event

Update an existing event. Only provided fields are changed.

- `event_id` (required): Event ID to update
- `summary`, `start`, `end`, `description`, `location`, `status`, `attendees` (all optional)

To confirm a tentative event: `gcal_update_event(event_id=..., status="confirmed")`

### gcal_delete_event

Delete a calendar event.

- `event_id` (required): Event ID to delete

## Event Confirmation Workflow

1. Create event as tentative: `gcal_create_event(summary=..., start=..., end=...)`
2. Show the user the event details and ask for confirmation
3. On user approval: `gcal_update_event(event_id=..., status="confirmed")`
4. On rejection: `gcal_delete_event(event_id=...)`

## Cross-Reference with Email

When both google-email and google-calendar skills are installed:
- Before triaging emails, fetch upcoming events with `gcal_list_events`
- Note connections between emails and calendar events (e.g., meeting prep emails)
- Include calendar context in triage summaries
