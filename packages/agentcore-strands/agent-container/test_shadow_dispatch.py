"""Tests for shadow_dispatch — dual-dispatch + divergence logging.

Run with:
    uv run --no-project --with pytest --with pytest-asyncio \
        pytest packages/agentcore-strands/agent-container/test_shadow_dispatch.py
"""

from __future__ import annotations

import asyncio
import logging

import pytest
import pytest_asyncio  # noqa: F401
from shadow_dispatch import (
    SHADOW_FLAG_ENV,
    ShadowOutcome,
    is_shadow_enabled,
    parse_shadow_flag,
    run_shadow,
    run_shadow_concurrent,
)

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------


def test_parse_shadow_flag_empty_and_none_produce_empty_set():
    assert parse_shadow_flag(None) == frozenset()
    assert parse_shadow_flag("") == frozenset()
    assert parse_shadow_flag("   ") == frozenset()


def test_parse_shadow_flag_splits_on_comma_and_trims_whitespace():
    assert parse_shadow_flag("a,b,c") == frozenset({"a", "b", "c"})
    assert parse_shadow_flag(" sales-prep , renewal-prep ") == frozenset(
        {"sales-prep", "renewal-prep"}
    )


def test_parse_shadow_flag_drops_empty_segments():
    assert parse_shadow_flag(",,,demo,,") == frozenset({"demo"})


def test_is_shadow_enabled_uses_env_when_set(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "alpha,beta")
    assert is_shadow_enabled("alpha") is True
    assert is_shadow_enabled("gamma") is False


def test_is_shadow_enabled_noop_when_unset(monkeypatch):
    monkeypatch.delenv(SHADOW_FLAG_ENV, raising=False)
    assert is_shadow_enabled("alpha") is False


# ---------------------------------------------------------------------------
# run_shadow — no-op path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_shadow_returns_none_when_flag_unset(monkeypatch):
    monkeypatch.delenv(SHADOW_FLAG_ENV, raising=False)

    new_called = False

    async def new_path():
        nonlocal new_called
        new_called = True
        return {"any": "thing"}

    outcome = await run_shadow(
        slug="sales-prep",
        tenant_id="t",
        environment="dev",
        old_result={"old": "result"},
        old_duration_ms=42,
        new_path=new_path,
    )
    assert outcome is None
    assert new_called is False, "new path must never run when flag is off"


@pytest.mark.asyncio
async def test_run_shadow_returns_none_when_slug_not_in_flag(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "other-skill")

    new_called = False

    async def new_path():
        nonlocal new_called
        new_called = True
        return {}

    outcome = await run_shadow(
        slug="sales-prep",
        tenant_id="t",
        environment="dev",
        old_result={"old": 1},
        old_duration_ms=10,
        new_path=new_path,
    )
    assert outcome is None
    assert new_called is False


# ---------------------------------------------------------------------------
# run_shadow — active path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_shadow_matches_when_paths_produce_same_result(monkeypatch, caplog):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "sales-prep")

    async def new_path():
        return {"brief": "ready"}

    with caplog.at_level(logging.INFO, logger="shadow_dispatch"):
        outcome = await run_shadow(
            slug="sales-prep",
            tenant_id="tenant-1",
            environment="dev",
            old_result={"brief": "ready"},
            old_duration_ms=100,
            new_path=new_path,
        )

    assert outcome is not None
    assert outcome.divergent is False
    assert outcome.old_hash == outcome.new_hash
    assert outcome.slug == "sales-prep"
    assert outcome.tenant_id == "tenant-1"
    assert outcome.environment == "dev"
    assert outcome.old_duration_ms == 100
    assert outcome.new_duration_ms is not None
    assert outcome.new_error_kind is None
    assert outcome.shape == ["brief"]

    # The log line carries all structured fields for CloudWatch Log
    # Insights to aggregate against.
    divergence_records = [r for r in caplog.records if r.msg == "capability_shadow_divergence"]
    assert len(divergence_records) == 1


@pytest.mark.asyncio
async def test_run_shadow_flags_divergence_when_results_differ(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "sales-prep")

    async def new_path():
        return {"brief": "different"}

    outcome = await run_shadow(
        slug="sales-prep",
        tenant_id="t",
        environment="dev",
        old_result={"brief": "ready"},
        old_duration_ms=50,
        new_path=new_path,
    )

    assert outcome is not None
    assert outcome.divergent is True
    assert outcome.old_hash != outcome.new_hash


@pytest.mark.asyncio
async def test_run_shadow_hash_is_key_order_independent(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "demo")

    async def new_path():
        return {"b": 2, "a": 1}  # same content, different order

    outcome = await run_shadow(
        slug="demo",
        tenant_id="t",
        environment="dev",
        old_result={"a": 1, "b": 2},
        old_duration_ms=10,
        new_path=new_path,
    )
    assert outcome is not None
    assert outcome.divergent is False, (
        "hash must be key-order-independent or every dict comparison "
        "falsely fails"
    )


# ---------------------------------------------------------------------------
# run_shadow — new path failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_shadow_captures_new_path_exception_without_reraising(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "broken-skill")

    async def new_path():
        raise RuntimeError("new path exploded")

    # No pytest.raises — shadow *must not* raise to the caller.
    outcome = await run_shadow(
        slug="broken-skill",
        tenant_id="t",
        environment="dev",
        old_result={"still": "works"},
        old_duration_ms=5,
        new_path=new_path,
    )

    assert outcome is not None
    assert outcome.new_hash is None
    assert outcome.divergent is True
    assert outcome.new_error_kind == "RuntimeError"
    assert outcome.new_error_message == "new path exploded"
    assert outcome.shape == []


@pytest.mark.asyncio
async def test_run_shadow_truncates_long_error_messages(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "broken")

    async def new_path():
        raise RuntimeError("X" * 5000)

    outcome = await run_shadow(
        slug="broken",
        tenant_id="t",
        environment="dev",
        old_result={},
        old_duration_ms=1,
        new_path=new_path,
    )
    assert outcome is not None
    # 512-char bound keeps a pathological skill from blowing out log size.
    assert outcome.new_error_message is not None
    assert len(outcome.new_error_message) <= 512


# ---------------------------------------------------------------------------
# run_shadow_concurrent — concurrent variant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_shadow_concurrent_returns_old_result_regardless_of_new(monkeypatch):
    monkeypatch.setenv(SHADOW_FLAG_ENV, "sales-prep")

    async def old_path():
        return {"brief": "OLD"}

    async def new_path():
        return {"brief": "NEW"}  # intentionally divergent

    result, outcome = await run_shadow_concurrent(
        slug="sales-prep",
        tenant_id="t",
        environment="dev",
        old_path=old_path,
        new_path=new_path,
    )

    # The caller always sees the old result — shadow is pure instrumentation.
    assert result == {"brief": "OLD"}
    assert outcome is not None
    assert outcome.divergent is True


@pytest.mark.asyncio
async def test_run_shadow_concurrent_skips_new_when_flag_unset(monkeypatch):
    monkeypatch.delenv(SHADOW_FLAG_ENV, raising=False)

    new_called = False

    async def old_path():
        return {"x": 1}

    async def new_path():
        nonlocal new_called
        new_called = True
        return {"x": 1}

    result, outcome = await run_shadow_concurrent(
        slug="demo",
        tenant_id="t",
        environment="dev",
        old_path=old_path,
        new_path=new_path,
    )
    assert result == {"x": 1}
    assert outcome is None
    assert new_called is False


@pytest.mark.asyncio
async def test_run_shadow_concurrent_runs_paths_in_parallel(monkeypatch):
    """Total wall time should approximate max(old, new), not sum(old, new).

    Proves the concurrent variant actually overlaps the two invocations
    rather than serialising them.
    """
    monkeypatch.setenv(SHADOW_FLAG_ENV, "demo")

    async def slow(ms: int, value):
        await asyncio.sleep(ms / 1000)
        return value

    import time as _time

    t0 = _time.monotonic()
    result, outcome = await run_shadow_concurrent(
        slug="demo",
        tenant_id="t",
        environment="dev",
        old_path=lambda: slow(100, {"o": 1}),
        new_path=lambda: slow(100, {"o": 1}),
    )
    elapsed_ms = (_time.monotonic() - t0) * 1000

    assert result == {"o": 1}
    assert outcome is not None
    # Serial would be ~200ms; concurrent ~100ms + jitter. 180ms is a
    # generous upper bound that catches a regression without flaking on
    # slow CI hosts.
    assert elapsed_ms < 180, f"expected concurrent ~100ms, got {elapsed_ms:.0f}ms"


# ---------------------------------------------------------------------------
# ShadowOutcome.to_log_fields stability
# ---------------------------------------------------------------------------


def test_shadow_outcome_log_shape_is_stable():
    """CloudWatch Log Insights saved queries depend on this field set.

    New fields may be appended; existing fields must never be renamed
    or removed. This test locks the contract.
    """
    outcome = ShadowOutcome(
        slug="s",
        tenant_id="t",
        environment="e",
        old_hash="a" * 64,
        new_hash="b" * 64,
        divergent=True,
        old_duration_ms=1,
        new_duration_ms=2,
        new_error_kind=None,
        new_error_message=None,
        shape=["x", "y"],
    )
    fields = outcome.to_log_fields()
    expected_keys = {
        "slug",
        "tenant_id",
        "environment",
        "old_hash",
        "new_hash",
        "divergent",
        "old_duration_ms",
        "new_duration_ms",
        "new_error_kind",
        "new_error_message",
        "shape",
    }
    assert expected_keys.issubset(fields.keys())
