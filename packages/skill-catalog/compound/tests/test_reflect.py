"""Tests for the compound.reflect script.

Covers: scope + LLM extraction + store contract, write-failure swallow,
and LLM-garbage validation (non-JSON, empty, too long → skipped).

The Bedrock converse call and memory.store_learning are both stubbed —
we're testing the skill's parsing/validation logic, not AWS.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "reflect.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("compound_reflect", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["compound_reflect"] = module
    spec.loader.exec_module(module)
    return module


def test_happy_path_writes_three_learnings() -> None:
    mod = _load_module()
    llm_text = json.dumps({
        "learnings": [
            "Rep opens every meeting with invoice status.",
            "Customer cares more about uptime than price.",
            "Expansion requires sign-off from ops director.",
        ],
    })
    writes: list[tuple[dict, str]] = []

    def fake_store(scope, content):
        writes.append((scope, content))
        return True

    with mock.patch.object(mod, "_bedrock_extract", return_value=llm_text), \
         mock.patch.object(mod, "_store_learning", side_effect=fake_store):
        out = mod.compound_reflect(
            tenant_id="T1",
            user_id="U1",
            skill_id="sales-prep",
            subject_entity_id="cust-abc",
            run_inputs='{"customer":"ABC","meeting_date":"2026-05-01"}',
            deliverable="# Sales meeting brief — ABC Fuels\n...",
        )

    assert len(writes) == 3
    for scope, _content in writes:
        assert scope == {
            "tenant_id": "T1",
            "user_id": "U1",
            "skill_id": "sales-prep",
            "subject_entity_id": "cust-abc",
        }
    assert '"stored": 3' in out or "3 learnings" in out


def test_cap_at_three_even_if_llm_returns_more() -> None:
    mod = _load_module()
    llm_text = json.dumps({"learnings": [f"L{i}" for i in range(10)]})
    writes: list = []
    with mock.patch.object(mod, "_bedrock_extract", return_value=llm_text), \
         mock.patch.object(mod, "_store_learning", side_effect=lambda s, c: writes.append(c) or True):
        mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    assert len(writes) == 3


def test_store_failure_is_swallowed() -> None:
    """The compound.reflect step MUST NOT fail the composition just because
    AgentCore Memory rejected a write. Per the plan:
    'compositions should not fail because learnings couldn't be stored'."""
    mod = _load_module()
    llm_text = json.dumps({"learnings": ["A", "B"]})
    with mock.patch.object(mod, "_bedrock_extract", return_value=llm_text), \
         mock.patch.object(mod, "_store_learning", return_value=False):
        # Should not raise.
        out = mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    assert "stored" in out.lower() or "skipped" in out.lower()


def test_bedrock_exception_is_swallowed() -> None:
    mod = _load_module()
    with mock.patch.object(mod, "_bedrock_extract", side_effect=RuntimeError("bedrock down")), \
         mock.patch.object(mod, "_store_learning") as store:
        out = mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    store.assert_not_called()
    assert "skipped" in out.lower() or "no learnings" in out.lower()


def test_non_json_llm_output_skipped() -> None:
    mod = _load_module()
    garbage = "I think some learnings might include... (free-form rambling)"
    with mock.patch.object(mod, "_bedrock_extract", return_value=garbage), \
         mock.patch.object(mod, "_store_learning") as store:
        out = mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    store.assert_not_called()
    assert "skipped" in out.lower() or "no learnings" in out.lower()


def test_empty_llm_output_skipped() -> None:
    mod = _load_module()
    with mock.patch.object(mod, "_bedrock_extract", return_value=""), \
         mock.patch.object(mod, "_store_learning") as store:
        mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    store.assert_not_called()


def test_overly_long_learnings_dropped_not_stored() -> None:
    """A single 'learning' that's 5k chars long is almost certainly the
    LLM dumping the full deliverable back at us. Drop it per the
    validation rule in the plan."""
    mod = _load_module()
    llm_text = json.dumps({"learnings": [
        "Reasonable observation.",
        "x" * 5000,  # too long
        "Another reasonable one.",
    ]})
    writes: list = []
    with mock.patch.object(mod, "_bedrock_extract", return_value=llm_text), \
         mock.patch.object(mod, "_store_learning", side_effect=lambda s, c: writes.append(c) or True):
        mod.compound_reflect(
            tenant_id="T1", skill_id="sales-prep",
            run_inputs="{}", deliverable="d",
        )
    assert len(writes) == 2
    assert all(len(w) < 2000 for w in writes)


def test_missing_required_scope_skips_without_llm_call() -> None:
    mod = _load_module()
    with mock.patch.object(mod, "_bedrock_extract") as extract, \
         mock.patch.object(mod, "_store_learning") as store:
        out = mod.compound_reflect(
            tenant_id="", skill_id="",
            run_inputs="{}", deliverable="d",
        )
    extract.assert_not_called()
    store.assert_not_called()
    assert "skipped" in out.lower()


def test_omits_optional_scope_fields_on_write() -> None:
    mod = _load_module()
    llm_text = json.dumps({"learnings": ["Only one"]})
    captured_scope = {}
    with mock.patch.object(mod, "_bedrock_extract", return_value=llm_text), \
         mock.patch.object(mod, "_store_learning",
                           side_effect=lambda s, c: captured_scope.update(s) or True):
        mod.compound_reflect(
            tenant_id="T1",
            user_id="",
            skill_id="sales-prep",
            subject_entity_id="",
            run_inputs="{}",
            deliverable="d",
        )
    assert "user_id" not in captured_scope
    assert "subject_entity_id" not in captured_scope


def test_docstring_declares_write_contract() -> None:
    """Paired with recall — reflect's docstring must declare the write
    contract (non-obvious observations, capped, scoped). Edit the two
    docstrings together per feedback_hindsight_recall_reflect_pair."""
    mod = _load_module()
    doc = mod.compound_reflect.__doc__ or ""
    assert "compound_recall" in doc
    # Write contract markers:
    assert "non-obvious" in doc.lower() or "concrete" in doc.lower()
    assert "3" in doc or "three" in doc.lower()
