"""Hindsight Memory Engine client — stdlib-only HTTP client.

PRD-41B: Provides retain/recall/reflect operations against the Hindsight API.
Uses urllib (no external dependencies) since agent containers don't have httpx/requests.

When HINDSIGHT_ENDPOINT is empty, is_available() returns False and all calls are no-ops.
"""

import os
import json
import logging
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

logger = logging.getLogger(__name__)


def _get_endpoint() -> str:
    """Read endpoint at call time (not import time) because server.py sets it from the payload."""
    return os.environ.get("HINDSIGHT_ENDPOINT", "")


def is_available() -> bool:
    """Check if Hindsight is configured (HINDSIGHT_ENDPOINT env var set)."""
    ep = _get_endpoint()
    if ep:
        logger.info("Hindsight available at: %s", ep)
    return bool(ep)


def _request(method: str, path: str, body: dict = None, timeout: int = 30) -> dict:
    """Make an HTTP request to the Hindsight API."""
    endpoint = _get_endpoint()
    if not endpoint:
        return {}

    url = f"{endpoint}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")

    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8")[:500]
        except Exception:
            pass
        logger.error("Hindsight %s %s → HTTP %d: %s", method, path, e.code, body_text)
        return {}
    except URLError as e:
        logger.error("Hindsight %s %s → %s", method, path, e.reason)
        return {}
    except Exception as e:
        logger.error("Hindsight %s %s → %s: %s", method, path, type(e).__name__, e)
        return {}


# ---------------------------------------------------------------------------
# Core API Methods
# ---------------------------------------------------------------------------

def retain(bank_id: str, content: str, **kwargs) -> dict:
    """Store content in Hindsight. Triggers fact extraction, ER, and graph building."""
    # API expects items array, not bare content
    items = [{"content": content}]
    for k in ("context", "timestamp", "document_id", "metadata", "tags", "entities"):
        if k in kwargs:
            items[0][k] = kwargs.pop(k)
    payload = {"items": items, **kwargs}
    return _request("POST", f"/v1/default/banks/{bank_id}/memories", payload, timeout=60)


def recall(bank_id: str, query: str, **kwargs) -> dict:
    """Search memories using multi-strategy retrieval (semantic + BM25 + graph + temporal)."""
    payload = {"query": query, **kwargs}
    return _request("POST", f"/v1/default/banks/{bank_id}/memories/recall", payload)


def reflect(bank_id: str, query: str, **kwargs) -> dict:
    """Generate a disposition-aware response using memories and observations."""
    payload = {"query": query, **kwargs}
    return _request("POST", f"/v1/default/banks/{bank_id}/reflect", payload)


# ---------------------------------------------------------------------------
# Bank Management
# ---------------------------------------------------------------------------

def configure_bank(bank_id: str, config: dict) -> dict:
    """Update bank configuration (retain_mission, extraction mode, etc.)."""
    return _request("PATCH", f"/v1/default/banks/{bank_id}/config", config)


def list_entities(bank_id: str) -> dict:
    """List all entities (people, orgs, etc.) known by the bank."""
    return _request("GET", f"/v1/default/banks/{bank_id}/entities")
