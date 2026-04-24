"""Shadow-traffic A/B harness for the old→new skill-dispatch cutover.

## What it does

When the env var ``SKILL_DISPATCH_SHADOW`` names a skill slug, every real
invocation of that slug runs *both* the currently-live path and the
candidate replacement (today:
``skill_dispatcher.dispatch_skill_script``). The model and the user see
**only** the live path's result — shadow never changes behavior. The
dispatcher logs a structured ``capability_shadow_divergence`` CloudWatch
line per call with the signals needed to decide cutover:

  * ``slug``, ``tenant_id``, ``environment``
  * ``old_hash`` / ``new_hash`` — sha256 of the JSON-serialised result
  * ``divergent`` — bool (old_hash != new_hash)
  * ``old_duration_ms`` / ``new_duration_ms``
  * ``new_error_kind`` / ``new_error_message`` — populated when the new
    path raised; the old path's result is still returned unchanged
  * ``shape`` — top-level keys of the new result for per-stage triage

30+ days clean per slug = shape divergence < 5% + zero human-judged
semantic regressions → cutover flips for that slug. The dashboard that
surfaces this lives in the CloudWatch Log Insights saved queries.

## Why kept post-U6

U6 removed the parallel composition runner but left the shadow harness
in place. It's the instrumentation for any future per-slug old→new
cutover the runtime needs — cheap to keep, zero cost when the
``SKILL_DISPATCH_SHADOW`` flag is empty, and the structured log
contract (``capability_shadow_divergence``) is load-bearing for the
saved CloudWatch queries.

## Invariants

* Shadow **never** raises back to the caller. A new-path failure logs a
  structured record and returns normally.
* Shadow **never** modifies the returned value. The caller gets the old
  result verbatim.
* When the flag is empty / unset / does not include the current slug,
  ``run_shadow`` is a no-op that returns the old result immediately —
  zero runtime cost for slugs not under A/B.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Env var the runtime flips on to mark a slug for shadow dispatch. Comma-sep
# list. Empty / unset = no shadow. The plan's cutover sequence is: flip a
# slug ON via this flag → soak 30+ days → verify shape divergence < 5% +
# zero human-judged regressions → remove the slug from the list → delete
# the legacy path for that slug in a later PR.
SHADOW_FLAG_ENV = "SKILL_DISPATCH_SHADOW"


@dataclass
class ShadowOutcome:
    """The structured signal a single shadow call produces.

    Emitted as a CloudWatch structured log line so Log Insights queries
    can aggregate per-slug divergence without a separate metrics pipeline.
    The field set is stable — add new fields at the end, never rename
    existing ones (saved queries depend on them).
    """

    slug: str
    tenant_id: str
    environment: str
    old_hash: str
    new_hash: str | None
    divergent: bool
    old_duration_ms: int
    new_duration_ms: int | None
    new_error_kind: str | None = None
    new_error_message: str | None = None
    shape: list[str] = field(default_factory=list)

    def to_log_fields(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "tenant_id": self.tenant_id,
            "environment": self.environment,
            "old_hash": self.old_hash,
            "new_hash": self.new_hash,
            "divergent": self.divergent,
            "old_duration_ms": self.old_duration_ms,
            "new_duration_ms": self.new_duration_ms,
            "new_error_kind": self.new_error_kind,
            "new_error_message": self.new_error_message,
            "shape": self.shape,
        }


def parse_shadow_flag(raw: str | None) -> frozenset[str]:
    """Parse ``SKILL_DISPATCH_SHADOW`` into a slug set.

    Accepts comma-separated slugs with whitespace tolerance. Empty or
    unset returns an empty set — the caller's ``in`` check becomes a
    cheap no-op when nothing is under A/B.
    """
    if not raw:
        return frozenset()
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


def _env_shadow_set() -> frozenset[str]:
    return parse_shadow_flag(os.environ.get(SHADOW_FLAG_ENV))


def is_shadow_enabled(slug: str, *, env_set: frozenset[str] | None = None) -> bool:
    """Cheap pre-check — callers short-circuit before running the new path."""
    active = env_set if env_set is not None else _env_shadow_set()
    return slug in active


def _hash_result(value: Any) -> str:
    """Deterministic sha256 of the JSON-serialised result.

    Keys sorted so two dicts with the same content but different order
    still compare equal by hash. Non-JSON-able inputs (Python objects
    leaking through) raise at log time — the test suite pins the shape.
    """
    serialised = json.dumps(value, sort_keys=True, default=_safe_default)
    return hashlib.sha256(serialised.encode("utf-8")).hexdigest()


def _safe_default(obj: Any) -> Any:
    # Fallback for values JSON cannot handle (dataclasses, bytes). Stable
    # string representation keeps the hash deterministic even when the
    # underlying value carries an unfortunate type.
    return repr(obj)


def _shape_keys(value: Any) -> list[str]:
    if isinstance(value, dict):
        return sorted(value.keys())
    return [type(value).__name__]


async def run_shadow(
    *,
    slug: str,
    tenant_id: str,
    environment: str,
    old_result: Any,
    old_duration_ms: int,
    new_path: Callable[[], Awaitable[Any]],
) -> ShadowOutcome | None:
    """Run the new path in the shadow when the slug is flagged.

    Returns None (and does no work) when the slug is not in the shadow
    set. Returns a ShadowOutcome — emitted as a structured log line —
    when it is. The caller forwards the old result to the user
    regardless; this is instrumentation, not a behavior gate.
    """
    active = _env_shadow_set()
    if slug not in active:
        return None

    old_hash = _hash_result(old_result)
    new_hash: str | None = None
    new_duration_ms: int | None = None
    new_error_kind: str | None = None
    new_error_message: str | None = None
    shape: list[str] = []

    start = time.monotonic()
    try:
        new_result = await new_path()
        new_duration_ms = int((time.monotonic() - start) * 1000)
        new_hash = _hash_result(new_result)
        shape = _shape_keys(new_result)
    except Exception as e:  # noqa: BLE001 — shadow never raises
        new_duration_ms = int((time.monotonic() - start) * 1000)
        new_error_kind = type(e).__name__
        # Bound the message so a pathological skill can't blow out the
        # log line. 512 chars is well within a CloudWatch line limit
        # and enough for a stack trace head.
        new_error_message = str(e)[:512]

    outcome = ShadowOutcome(
        slug=slug,
        tenant_id=tenant_id,
        environment=environment,
        old_hash=old_hash,
        new_hash=new_hash,
        divergent=(new_hash is None) or (new_hash != old_hash),
        old_duration_ms=old_duration_ms,
        new_duration_ms=new_duration_ms,
        new_error_kind=new_error_kind,
        new_error_message=new_error_message,
        shape=shape,
    )
    logger.info(
        "capability_shadow_divergence",
        extra={"shadow": outcome.to_log_fields()},
    )
    return outcome


async def run_shadow_concurrent(
    *,
    slug: str,
    tenant_id: str,
    environment: str,
    old_path: Callable[[], Awaitable[Any]],
    new_path: Callable[[], Awaitable[Any]],
) -> tuple[Any, ShadowOutcome | None]:
    """Variant that runs old and new concurrently and returns the old result.

    Used by callers that can afford to start the new path in parallel
    with the old — saves latency in shadow mode. When the slug is not
    flagged, only the old path runs (new_path is never called).
    """
    active = _env_shadow_set()
    if slug not in active:
        old_start = time.monotonic()
        old_result = await old_path()
        return old_result, None

    # Kick off both; measure durations separately so a slow new path
    # doesn't smear its latency into the old-path number.
    old_start = time.monotonic()
    old_task = asyncio.create_task(old_path())
    new_start = time.monotonic()
    new_task = asyncio.create_task(new_path())

    old_result = await old_task
    old_duration_ms = int((time.monotonic() - old_start) * 1000)

    # Drain the new path to completion (or failure) for signal capture.
    new_hash: str | None = None
    new_duration_ms: int | None = None
    new_error_kind: str | None = None
    new_error_message: str | None = None
    shape: list[str] = []
    try:
        new_result = await new_task
        new_duration_ms = int((time.monotonic() - new_start) * 1000)
        new_hash = _hash_result(new_result)
        shape = _shape_keys(new_result)
    except Exception as e:  # noqa: BLE001
        new_duration_ms = int((time.monotonic() - new_start) * 1000)
        new_error_kind = type(e).__name__
        new_error_message = str(e)[:512]

    old_hash = _hash_result(old_result)
    outcome = ShadowOutcome(
        slug=slug,
        tenant_id=tenant_id,
        environment=environment,
        old_hash=old_hash,
        new_hash=new_hash,
        divergent=(new_hash is None) or (new_hash != old_hash),
        old_duration_ms=old_duration_ms,
        new_duration_ms=new_duration_ms,
        new_error_kind=new_error_kind,
        new_error_message=new_error_message,
        shape=shape,
    )
    logger.info(
        "capability_shadow_divergence",
        extra={"shadow": outcome.to_log_fields()},
    )
    return old_result, outcome


__all__ = [
    "SHADOW_FLAG_ENV",
    "ShadowOutcome",
    "is_shadow_enabled",
    "parse_shadow_flag",
    "run_shadow",
    "run_shadow_concurrent",
]
