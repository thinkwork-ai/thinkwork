"""Tests for the compound.recall script.

Covers: scope shape, priority-first rendering, empty-scope safety, and
the failure-swallow invariant (recall never raises into the composition).

The memory.recall_learnings function is stubbed — we're testing the
skill's input handling and output shape, not the underlying store.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "recall.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("compound_recall", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["compound_recall"] = module
    spec.loader.exec_module(module)
    return module


def test_happy_path_user_then_tenant_ordering() -> None:
    mod = _load_module()
    fake_learnings = [
        {"text": "Rep always asks about renewals first.", "priority": 0, "score": 0.9},
        {"text": "Tenant-wide: check AR aging for manufacturing customers.", "priority": 1, "score": 0.8},
    ]
    with mock.patch.object(mod, "_recall_learnings", return_value=fake_learnings):
        out = mod.compound_recall(
            tenant_id="T1",
            user_id="U1",
            skill_id="sales-prep",
            query="ABC Fuels Inc meeting",
            subject_entity_id="cust-abc",
        )
    assert "Rep always asks about renewals first." in out
    assert "check AR aging" in out
    # User-scoped learning must render before tenant-scoped.
    assert out.index("renewals") < out.index("AR aging")


def test_empty_learnings_returns_empty_string_not_placeholder() -> None:
    """No prior learnings is a valid and common state — recall returns an
    empty string. Composition step receives '' for prior_learnings and
    synthesize/frame know to treat absence as benign."""
    mod = _load_module()
    with mock.patch.object(mod, "_recall_learnings", return_value=[]):
        out = mod.compound_recall(
            tenant_id="T1", skill_id="sales-prep", query="ABC",
        )
    assert out == ""


def test_missing_required_scope_returns_empty() -> None:
    """A caller that forgets to pass tenant_id/skill_id must not blow up
    the composition. Recall is best-effort."""
    mod = _load_module()
    with mock.patch.object(mod, "_recall_learnings") as fake:
        out = mod.compound_recall(
            tenant_id="", skill_id="", query="x",
        )
    assert out == ""
    fake.assert_not_called()


def test_swallows_memory_exception() -> None:
    mod = _load_module()
    with mock.patch.object(mod, "_recall_learnings", side_effect=RuntimeError("AWS")):
        out = mod.compound_recall(
            tenant_id="T1", skill_id="sales-prep", query="x",
        )
    assert out == ""


def test_scope_built_from_args_passes_to_memory() -> None:
    mod = _load_module()
    with mock.patch.object(mod, "_recall_learnings", return_value=[]) as fake:
        mod.compound_recall(
            tenant_id="T1",
            user_id="U1",
            skill_id="sales-prep",
            query="ABC Fuels",
            subject_entity_id="cust-abc",
            top_k=7,
        )
    scope_arg = fake.call_args.args[0]
    assert scope_arg == {
        "tenant_id": "T1",
        "user_id": "U1",
        "skill_id": "sales-prep",
        "subject_entity_id": "cust-abc",
    }
    # top_k forwarded
    assert fake.call_args.kwargs.get("top_k") == 7 or fake.call_args.args[2:] == (7,)


def test_omits_optional_scope_fields_when_empty_string() -> None:
    """Empty-string defaults for user_id/subject_entity_id must not leak
    as literal filter values into the scope — they'd mismatch every
    stored record. Drop empty strings."""
    mod = _load_module()
    with mock.patch.object(mod, "_recall_learnings", return_value=[]) as fake:
        mod.compound_recall(
            tenant_id="T1",
            user_id="",
            skill_id="sales-prep",
            query="x",
            subject_entity_id="",
        )
    scope_arg = fake.call_args.args[0]
    assert "user_id" not in scope_arg
    assert "subject_entity_id" not in scope_arg


def test_docstring_declares_required_followup() -> None:
    """The recall/reflect pair contract (auto-memory feedback_hindsight_recall_reflect_pair):
    recall's docstring must name reflect as the required follow-up so the
    downstream LLM knows to chain them. Edit the two docstrings together."""
    mod = _load_module()
    doc = mod.compound_recall.__doc__ or ""
    assert "REQUIRED FOLLOW-UP" in doc.upper() or "required follow-up" in doc
    assert "compound_reflect" in doc
