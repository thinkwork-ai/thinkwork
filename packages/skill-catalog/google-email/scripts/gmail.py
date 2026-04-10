"""Gmail skill — Python port of the google-email MCP server."""

import base64
import functools
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GMAIL_ACCESS_TOKEN = os.environ.get("GMAIL_ACCESS_TOKEN", "")


# -- Helpers -----------------------------------------------------------------


def _handle_errors(fn):
    """Wrap tool functions so API/network errors return JSON error strings."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            return json.dumps({"error": f"Gmail API error (HTTP {e.code}): {body}"})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    return wrapper


def _gmail_api(method: str, path: str, body: dict | None = None) -> dict:
    """Call the Gmail REST API and return the parsed JSON response."""
    if not GMAIL_ACCESS_TOKEN:
        raise RuntimeError("GMAIL_ACCESS_TOKEN not set. Ensure the google-email skill is connected.")

    url = path if path.startswith("https://") else f"{GMAIL_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Authorization": f"Bearer {GMAIL_ACCESS_TOKEN}"}
    if body:
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, timeout=30)
    raw = resp.read().decode("utf-8")
    if not raw:
        return {}
    return json.loads(raw)


def _get_header(headers: list[dict], name: str) -> str:
    """Extract a header value (case-insensitive) from Gmail payload headers."""
    for h in headers or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _decode_body(data: str) -> str:
    """Decode a base64url-encoded Gmail body part."""
    try:
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except Exception:
        return data


def _extract_body(payload: dict) -> str:
    """Recursively extract the plain-text body from a Gmail message payload."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain" and payload.get("body"):
        raw = payload["body"].get("data", "")
        return _decode_body(raw) if raw else ""
    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text
    return ""


def _base64url_encode(data: bytes) -> str:
    """Encode bytes to base64url with no padding (Gmail raw format)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _build_raw_message(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
    in_reply_to: str = "",
    references: str = "",
    html_body: str = "",
) -> str:
    """Build a base64url-encoded RFC 2822 message for the Gmail drafts API."""
    if html_body:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
        msg = MIMEText(body, "plain", "utf-8")

    msg["From"] = "me"
    msg["To"] = to
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc
    if bcc:
        msg["Bcc"] = bcc
    if in_reply_to:
        msg_id = in_reply_to if "<" in in_reply_to else f"<{in_reply_to}>"
        msg["In-Reply-To"] = msg_id
        msg["References"] = references or msg_id

    return _base64url_encode(msg.as_bytes())


# -- Tools -------------------------------------------------------------------


@_handle_errors
def gmail_list_messages(
    max_results: int = 20,
    page_token: str = "",
    query: str = "",
) -> str:
    """List messages in the user's Gmail inbox.

    Args:
        max_results: Maximum messages to return (default 20, max 100).
        page_token: Pagination token from a previous response.
        query: Gmail search query (e.g. 'is:unread', 'from:alice@example.com').

    Returns:
        JSON with message IDs, thread IDs, and nextPageToken.
    """
    params: dict[str, str] = {
        "labelIds": "INBOX",
        "maxResults": str(min(max_results, 100)),
    }
    if page_token:
        params["pageToken"] = page_token
    if query:
        params["q"] = query

    result = _gmail_api("GET", f"/messages?{urllib.parse.urlencode(params)}")
    return json.dumps(result)


@_handle_errors
def gmail_get_message(message_id: str, format: str = "full") -> str:
    """Get full details of a Gmail message including headers and decoded body.

    Args:
        message_id: The Gmail message ID.
        format: Response format — 'full' (default) or 'metadata' (headers only).

    Returns:
        JSON with id, threadId, labelIds, snippet, from, to, subject, date,
        messageId, inReplyTo, and body.
    """
    data = _gmail_api("GET", f"/messages/{message_id}?format={format}")

    payload = data.get("payload", {})
    if payload and format == "full":
        headers = payload.get("headers", [])
        return json.dumps({
            "id": data.get("id"),
            "threadId": data.get("threadId"),
            "labelIds": data.get("labelIds"),
            "snippet": data.get("snippet"),
            "from": _get_header(headers, "From"),
            "to": _get_header(headers, "To"),
            "subject": _get_header(headers, "Subject"),
            "date": _get_header(headers, "Date"),
            "messageId": _get_header(headers, "Message-ID"),
            "inReplyTo": _get_header(headers, "In-Reply-To"),
            "body": _extract_body(payload),
        })
    return json.dumps(data)


@_handle_errors
def gmail_search_messages(query: str, max_results: int = 20) -> str:
    """Search Gmail messages using Gmail search query syntax.

    Args:
        query: Gmail search query (e.g. 'from:alice subject:report after:2026/03/01').
        max_results: Maximum results (default 20, max 100).

    Returns:
        JSON with matching message IDs and nextPageToken.
    """
    params = {
        "q": query,
        "maxResults": str(min(max_results, 100)),
    }
    result = _gmail_api("GET", f"/messages?{urllib.parse.urlencode(params)}")
    return json.dumps(result)


@_handle_errors
def gmail_modify_labels(
    message_id: str,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
) -> str:
    """Modify labels on a Gmail message (archive, mark read, star, etc.).

    Args:
        message_id: The Gmail message ID.
        add_labels: Label IDs to add (e.g. ['STARRED', 'IMPORTANT']).
        remove_labels: Label IDs to remove (e.g. ['INBOX', 'UNREAD'] to archive+mark read).

    Returns:
        JSON with the updated message metadata.
    """
    result = _gmail_api("POST", f"/messages/{message_id}/modify", {
        "addLabelIds": add_labels or [],
        "removeLabelIds": remove_labels or [],
    })
    return json.dumps(result)


@_handle_errors
def gmail_create_draft(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
    in_reply_to: str = "",
    references: str = "",
    thread_id: str = "",
    html_body: str = "",
) -> str:
    """Create a Gmail draft. The user must review and send it manually.

    Args:
        to: Comma-separated recipient email addresses.
        subject: Email subject. For replies, prefix with 'Re: '.
        body: Plain text email body.
        cc: Comma-separated CC recipients.
        bcc: Comma-separated BCC recipients.
        in_reply_to: Message-ID of email being replied to (for threading).
        references: References header value (for threading).
        thread_id: Gmail thread ID to add this draft to.
        html_body: Optional HTML body (creates multipart alternative message).

    Returns:
        JSON with draft id, message metadata, and a deepLink to open in Gmail.
    """
    raw = _build_raw_message(
        to=to,
        subject=subject,
        body=body,
        cc=cc,
        bcc=bcc,
        in_reply_to=in_reply_to,
        references=references,
        html_body=html_body,
    )

    draft_body: dict = {"message": {"raw": raw}}
    if thread_id:
        draft_body["message"]["threadId"] = thread_id

    result = _gmail_api("POST", "/drafts", draft_body)
    draft_id = result.get("id", "")
    result["deepLink"] = f"https://mail.google.com/mail/u/0/#drafts/{draft_id}"
    return json.dumps(result)
