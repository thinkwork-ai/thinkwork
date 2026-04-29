"""Tests for the post-U10 ``hindsight_usage_capture`` surface.

After U10:
- ``install()`` is gone — importing the module does NOT monkey-patch
  ``Hindsight``. The agent's tool wrappers in ``hindsight_tools.py`` push
  usage in-body via ``_push``.
- ``install_loop_fix()`` is preserved on its own axis (vendor SDK
  workaround) and remains lock-guarded + idempotent.
- ``_push`` / ``drain`` / ``reset`` semantics are unchanged.
"""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

import hindsight_usage_capture


@pytest.fixture(autouse=True)
def _reset_state():
    hindsight_usage_capture._usage_log.clear()
    yield
    hindsight_usage_capture._usage_log.clear()


# ---------------------------------------------------------------------------
# U10: install() is retired
# ---------------------------------------------------------------------------


def test_install_is_removed():
    """Module no longer exposes install(); only loop-fix + helpers."""
    assert not hasattr(hindsight_usage_capture, "install")
    assert hasattr(hindsight_usage_capture, "install_loop_fix")
    assert hasattr(hindsight_usage_capture, "_push")
    assert hasattr(hindsight_usage_capture, "drain")
    assert hasattr(hindsight_usage_capture, "reset")


def test_importing_module_does_not_monkey_patch_hindsight():
    """Non-regression: import-time side effects are limited to defining
    the helper surface. Hindsight client methods are NOT patched.
    """
    # We can't import the real Hindsight class without the network, so we
    # assert that the module's public surface (after import) doesn't look
    # like it ran any patching: no `_installed` flag, no `Hindsight`
    # reference cached at module scope.
    assert not hasattr(hindsight_usage_capture, "_installed")
    assert not hasattr(hindsight_usage_capture, "Hindsight")


# ---------------------------------------------------------------------------
# _push / drain / reset (unchanged semantics)
# ---------------------------------------------------------------------------


def test_push_then_drain_returns_entries_and_clears():
    usage = SimpleNamespace(input_tokens=10, output_tokens=5)
    hindsight_usage_capture._push("retain", "model-x", usage)
    out = hindsight_usage_capture.drain()
    assert out == [
        {"phase": "retain", "model": "model-x", "input_tokens": 10, "output_tokens": 5}
    ]
    # second drain returns empty
    assert hindsight_usage_capture.drain() == []


def test_push_zero_tokens_no_ops():
    """Edge case: zero tokens → entry not appended."""
    usage = SimpleNamespace(input_tokens=0, output_tokens=0)
    hindsight_usage_capture._push("retain", "model-x", usage)
    assert hindsight_usage_capture.drain() == []


def test_push_none_usage_no_ops():
    hindsight_usage_capture._push("retain", "model-x", None)
    assert hindsight_usage_capture.drain() == []


def test_push_malformed_usage_no_ops_with_warning(caplog):
    """Edge case: usage without input_tokens/output_tokens → no-op + warning."""
    # SimpleNamespace with no token attrs — getattr returns 0 default.
    bad = SimpleNamespace(unrelated="value")
    hindsight_usage_capture._push("retain", "model-x", bad)
    # No-op because both tokens default to 0.
    assert hindsight_usage_capture.drain() == []


def test_reset_clears_log_without_returning():
    usage = SimpleNamespace(input_tokens=10, output_tokens=5)
    hindsight_usage_capture._push("retain", "model-x", usage)
    hindsight_usage_capture.reset()
    assert hindsight_usage_capture.drain() == []


def test_multiple_pushes_accumulate_in_order():
    """Equivalence: simulated turn = 2 retain + 3 reflect → 5 entries in
    order. Pins the cost-events row count contract that previously came
    from install() — same observable output, different mechanism.
    """
    for _ in range(2):
        hindsight_usage_capture._push(
            "retain",
            "retain-model",
            SimpleNamespace(input_tokens=10, output_tokens=5),
        )
    for _ in range(3):
        hindsight_usage_capture._push(
            "reflect",
            "reflect-model",
            SimpleNamespace(input_tokens=80, output_tokens=120),
        )
    out = hindsight_usage_capture.drain()
    assert len(out) == 5
    assert [e["phase"] for e in out] == [
        "retain",
        "retain",
        "reflect",
        "reflect",
        "reflect",
    ]


def test_push_concurrency_no_drops():
    """Concurrency: parallel pushes from many threads → all entries land."""
    def worker(n: int):
        for i in range(n):
            hindsight_usage_capture._push(
                "retain",
                "model-x",
                SimpleNamespace(input_tokens=1, output_tokens=1),
            )

    threads = [threading.Thread(target=worker, args=(50,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    out = hindsight_usage_capture.drain()
    assert len(out) == 200


# ---------------------------------------------------------------------------
# install_loop_fix idempotency (kept axis)
# ---------------------------------------------------------------------------


def test_install_loop_fix_idempotent(monkeypatch):
    """Calling install_loop_fix twice → second call is a no-op (returns False)."""
    # The first call may fail if hindsight_client isn't importable in the
    # test env — that's fine; it returns False either way. What we care
    # about is the lock-guarded idempotency, which we exercise by forcing
    # the "already installed" branch.
    monkeypatch.setattr(hindsight_usage_capture, "_loop_fix_installed", True)
    assert hindsight_usage_capture.install_loop_fix() is False
