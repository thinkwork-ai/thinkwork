"""Google Calendar skill — Python port of the google-calendar MCP server."""

import functools
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GCAL_ACCESS_TOKEN = os.environ.get("GCAL_ACCESS_TOKEN", "")


# -- Helpers -----------------------------------------------------------------


def _handle_errors(fn):
    """Wrap tool functions so API/network errors return JSON error strings."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            return json.dumps({"error": f"Calendar API error (HTTP {e.code}): {body}"})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    return wrapper


def _calendar_api(method: str, path: str, body: dict | None = None) -> dict:
    """Call the Google Calendar REST API and return the parsed JSON response."""
    if not GCAL_ACCESS_TOKEN:
        raise RuntimeError("GCAL_ACCESS_TOKEN not set. Ensure the google-calendar skill is connected.")

    url = path if path.startswith("https://") else f"{CALENDAR_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Authorization": f"Bearer {GCAL_ACCESS_TOKEN}"}
    if body:
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, timeout=30)
    raw = resp.read().decode("utf-8")
    if not raw:
        return {"status": "deleted"}
    return json.loads(raw)


def _build_time(iso_str: str, timezone: str = "") -> dict:
    """Build a Calendar API time object (dateTime vs all-day date)."""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", iso_str):
        return {"date": iso_str}
    result: dict = {"dateTime": iso_str}
    if timezone:
        result["timeZone"] = timezone
    return result


# -- Tools -------------------------------------------------------------------


@_handle_errors
def gcal_list_events(
    time_min: str,
    time_max: str,
    max_results: int = 50,
    page_token: str = "",
) -> str:
    """List events from the user's primary Google Calendar within a time range.

    Args:
        time_min: Start of time range in ISO 8601 (e.g. '2026-03-23T00:00:00Z').
        time_max: End of time range in ISO 8601 (e.g. '2026-03-23T23:59:59Z').
        max_results: Maximum events to return (default 50, max 250).
        page_token: Pagination token from a previous response.

    Returns:
        JSON with event summaries, times, attendees, locations, and nextPageToken.
    """
    params: dict[str, str] = {
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": str(min(max_results, 250)),
    }
    if page_token:
        params["pageToken"] = page_token

    result = _calendar_api("GET", f"/calendars/primary/events?{urllib.parse.urlencode(params)}")
    return json.dumps(result)


@_handle_errors
def gcal_get_event(event_id: str) -> str:
    """Get full details of a single Google Calendar event by its ID.

    Args:
        event_id: The Google Calendar event ID.

    Returns:
        JSON with the complete event resource.
    """
    result = _calendar_api("GET", f"/calendars/primary/events/{event_id}")
    return json.dumps(result)


@_handle_errors
def gcal_check_availability(time_min: str, time_max: str) -> str:
    """Check free/busy availability for the user's calendar within a time range.

    Args:
        time_min: Start of time range in ISO 8601.
        time_max: End of time range in ISO 8601.

    Returns:
        JSON with free/busy intervals for the primary calendar.
    """
    result = _calendar_api("POST", "/freeBusy", {
        "timeMin": time_min,
        "timeMax": time_max,
        "items": [{"id": "primary"}],
    })
    return json.dumps(result)


@_handle_errors
def gcal_create_event(
    summary: str,
    start: str,
    end: str,
    description: str = "",
    location: str = "",
    attendees: list[str] | None = None,
    timezone: str = "",
    recurrence: str = "",
    create_meet: bool = False,
) -> str:
    """Create a new event on the user's primary Google Calendar.

    Events are always created as tentative until the user confirms.

    Args:
        summary: Event title.
        start: Start time in ISO 8601 or date for all-day (e.g. '2026-03-24').
        end: End time in ISO 8601, or next day for all-day events.
        description: Event description/notes.
        location: Event location.
        attendees: List of attendee email addresses.
        timezone: Timezone (e.g. 'America/Chicago'). Defaults to calendar's timezone.
        recurrence: RRULE recurrence string (e.g. 'RRULE:FREQ=WEEKLY;COUNT=4').
        create_meet: If True, attach a Google Meet link to the event.

    Returns:
        JSON with the created event resource.
    """
    event: dict = {
        "summary": summary,
        "start": _build_time(start, timezone),
        "end": _build_time(end, timezone),
        "status": "tentative",
    }

    if description:
        event["description"] = description
    if location:
        event["location"] = location
    if recurrence:
        event["recurrence"] = [recurrence]
    if attendees:
        event["attendees"] = [{"email": email} for email in attendees]
    if create_meet:
        event["conferenceData"] = {
            "createRequest": {
                "requestId": f"thinkwork-{int(time.time() * 1000)}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            },
        }

    params = "?conferenceDataVersion=1" if create_meet else ""
    result = _calendar_api("POST", f"/calendars/primary/events{params}", event)
    return json.dumps(result)


@_handle_errors
def gcal_update_event(
    event_id: str,
    summary: str = "",
    start: str = "",
    end: str = "",
    description: str = "",
    location: str = "",
    status: str = "",
    attendees: list[str] | None = None,
) -> str:
    """Update an existing Google Calendar event. Only provided fields are changed.

    Args:
        event_id: The Google Calendar event ID to update.
        summary: New event title.
        start: New start time (ISO 8601).
        end: New end time (ISO 8601).
        description: New description.
        location: New location.
        status: Event status — 'confirmed', 'tentative', or 'cancelled'.
        attendees: Updated attendee email list (replaces existing).

    Returns:
        JSON with the updated event resource.
    """
    patch: dict = {}
    if summary:
        patch["summary"] = summary
    if description:
        patch["description"] = description
    if location:
        patch["location"] = location
    if status:
        patch["status"] = status
    if start:
        patch["start"] = _build_time(start)
    if end:
        patch["end"] = _build_time(end)
    if attendees is not None:
        patch["attendees"] = [{"email": email} for email in attendees]

    result = _calendar_api("PATCH", f"/calendars/primary/events/{event_id}", patch)
    return json.dumps(result)


@_handle_errors
def gcal_delete_event(event_id: str) -> str:
    """Delete a Google Calendar event.

    Args:
        event_id: The Google Calendar event ID to delete.

    Returns:
        JSON with status 'deleted'.
    """
    result = _calendar_api("DELETE", f"/calendars/primary/events/{event_id}")
    return json.dumps(result)
