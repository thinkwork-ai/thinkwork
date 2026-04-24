"""SI-7 capability-catalog client (plan §U15 pt 3/3).

At session start the Strands runtime asks the API for the set of built-in
tool slugs the catalog declares. Two consumers:

1. **Shadow-compare logging** — always on. We log the delta between the
   slugs the Python registration loop already prepared and the slugs the
   catalog allows, so operators can see whether enforcement would change
   this session's tool surface *before* flipping ``RCM_ENFORCE=true``.
2. **Enforcement filter** — gated by ``RCM_ENFORCE=true``. When enabled,
   tools whose slug isn't in the catalog set are dropped before
   ``Agent(tools=...)``. A catalog-missing built-in fails closed — the
   same SI-7 invariant the plan names.

Fail-open on fetch errors: a network blip must not brick every agent
turn. When the fetch fails or returns an empty set we log a WARN and
skip enforcement for this session; CloudWatch + ``capability_manifest``
(U15 pt 2) remain the durable observation.

The module is deliberately tiny + import-free from the rest of the
runtime — server.py pulls it in lazily so a capability_catalog bug
can't break container boot.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Matches manifest-log. Best-effort — API latency must not block a turn.
FETCH_TIMEOUT_SECONDS = 5


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CatalogSnapshot:
    """The slug set + version the runtime received for one (type, source) pair.

    ``ok`` is False when the fetch failed — callers should fail open
    (skip enforcement) rather than treat an empty slug set as "nothing
    allowed".
    """

    ok: bool
    slugs: frozenset[str]
    version: str = ""
    error: str = ""


def _resolve_api_env() -> tuple[str, str]:
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    return api_url, api_secret


def fetch_allowed_slugs(
    *, type_: str = "tool", source: str = "builtin",
) -> CatalogSnapshot:
    """Fetch the allowed slug set from the API.

    Returns ``CatalogSnapshot(ok=False, ...)`` on any failure — env
    missing, non-2xx, network error, malformed response. Callers must
    branch on ``ok`` before deciding whether to enforce.
    """
    api_url, api_secret = _resolve_api_env()
    if not api_url or not api_secret:
        logger.warning(
            "capability_catalog fetch_skipped reason=missing_env "
            "api_url_set=%s api_secret_set=%s",
            bool(api_url),
            bool(api_secret),
        )
        return CatalogSnapshot(ok=False, slugs=frozenset(), error="missing-env")

    qs = urllib.parse.urlencode({"type": type_, "source": source})
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/runtime/capability-catalog?{qs}",
        method="GET",
        headers={"Authorization": f"Bearer {api_secret}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SECONDS) as resp:
            status = resp.status
            if not (200 <= status < 300):
                logger.warning(
                    "capability_catalog fetch_failed status=%d", status,
                )
                return CatalogSnapshot(
                    ok=False,
                    slugs=frozenset(),
                    error=f"status_{status}",
                )
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        logger.warning(
            "capability_catalog fetch_failed status=%d err=%s",
            err.code,
            err.reason,
        )
        return CatalogSnapshot(
            ok=False, slugs=frozenset(), error=f"http_{err.code}",
        )
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        logger.warning("capability_catalog fetch_failed err=%s", err)
        return CatalogSnapshot(
            ok=False, slugs=frozenset(), error="network",
        )

    try:
        parsed = json.loads(body)
    except (TypeError, ValueError):
        logger.warning("capability_catalog fetch_failed err=malformed_json")
        return CatalogSnapshot(ok=False, slugs=frozenset(), error="parse")

    raw_slugs = parsed.get("slugs") if isinstance(parsed, dict) else None
    if not isinstance(raw_slugs, list):
        logger.warning(
            "capability_catalog fetch_failed err=missing_slugs_field",
        )
        return CatalogSnapshot(ok=False, slugs=frozenset(), error="shape")

    slugs = frozenset(s for s in raw_slugs if isinstance(s, str) and s)
    version = parsed.get("version") if isinstance(parsed, dict) else ""
    return CatalogSnapshot(
        ok=True, slugs=slugs, version=str(version or ""),
    )


# ---------------------------------------------------------------------------
# Filter + shadow-compare
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CatalogFilterResult:
    """Output of :func:`filter_by_catalog`.

    Split out so callers (server.py) can log a rich shadow-compare
    diagnostic without piecing it together from set deltas.
    """

    tools: list[Any]
    kept_slugs: tuple[str, ...]
    dropped_slugs: tuple[str, ...]
    unknown_in_catalog: tuple[str, ...]


def _resolve_tool_name(tool: Any) -> str | None:
    for attr in ("tool_name", "__name__"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value:
            return value
    return None


def filter_by_catalog(
    tools: Iterable[Any],
    *,
    allowed_slugs: frozenset[str],
) -> CatalogFilterResult:
    """Drop tools whose slug isn't in ``allowed_slugs``.

    Tools without a resolvable name flow through — metadata loss never
    silently strips capability. A slug present in the catalog but absent
    from the registered tool list surfaces in
    ``unknown_in_catalog`` so ops can triage a missing Python
    implementation.
    """
    kept: list[Any] = []
    kept_slugs: list[str] = []
    dropped_slugs: list[str] = []
    present_slugs: set[str] = set()

    for tool in tools:
        slug = _resolve_tool_name(tool)
        if slug is None:
            kept.append(tool)
            continue
        present_slugs.add(slug)
        if slug in allowed_slugs:
            kept.append(tool)
            kept_slugs.append(slug)
        else:
            dropped_slugs.append(slug)

    unknown_in_catalog = sorted(allowed_slugs - present_slugs)

    return CatalogFilterResult(
        tools=kept,
        kept_slugs=tuple(sorted(set(kept_slugs))),
        dropped_slugs=tuple(sorted(set(dropped_slugs))),
        unknown_in_catalog=tuple(unknown_in_catalog),
    )


def is_enforcement_enabled() -> bool:
    """``RCM_ENFORCE=true`` env flag. Default off.

    Split behind a function so tests can monkeypatch env cleanly.
    """
    return (os.environ.get("RCM_ENFORCE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def log_shadow_compare(
    *,
    registered_slugs: Iterable[str],
    catalog_slugs: frozenset[str],
    enforcement_enabled: bool,
    catalog_ok: bool,
) -> None:
    """Emit a structured line comparing today's vs catalog-allowed slugs.

    Always on — even when enforcement is off we want operators to be
    able to check "would flipping the flag change anything?" from
    CloudWatch. When the catalog fetch failed we still log the
    diagnostic so post-mortems can attribute behavior correctly.
    """
    registered = sorted(set(registered_slugs))
    would_drop = sorted(s for s in registered if s not in catalog_slugs)
    catalog_missing_tool = sorted(catalog_slugs - set(registered))
    payload = {
        "registered": registered,
        "catalog": sorted(catalog_slugs),
        "would_drop": would_drop,
        "catalog_missing_tool": catalog_missing_tool,
        "enforcement_enabled": enforcement_enabled,
        "catalog_ok": catalog_ok,
    }
    logger.info("capability_catalog_shadow %s", json.dumps(payload))
