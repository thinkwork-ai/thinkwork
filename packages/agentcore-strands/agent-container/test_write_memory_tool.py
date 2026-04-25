"""Tests for ``write_memory`` Strands tool — Plan §008 U12 (path parameter).

Replaces the basename-``Literal`` parameter with a path-validated string so
sub-agents can write to ``{folder}/memory/{basename}.md`` from the agent root.
ETag-guarded concurrency is deferred to a follow-up unit per Scope Boundaries.

Three layers exercised:

* ``TestValidateMemoryPath`` — pure validator coverage (security boundary)
* ``TestWriteMemoryTool``   — tool-end happy / error paths against a urllib mock
* (env-strip case stays in ``TestWriteMemoryTool``)

Run with::

    uv run --no-project --with pytest --with strands-agents \\
        pytest packages/agentcore-strands/agent-container/test_write_memory_tool.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch


def _unwrap(fn):
    """Strip the ``@tool`` wrapper so tests can call the underlying function."""
    return getattr(fn, "original_func", None) or getattr(fn, "__wrapped__", None) or fn


# ────────────────────────────────────────────────────────────────────────────
# Pure validator — security boundary
# ────────────────────────────────────────────────────────────────────────────


class TestValidateMemoryPath(unittest.TestCase):
    """Coverage for `_validate_memory_path` — the path security boundary.

    The validator returns the NFKC-normalized path on success; raises
    ``ValueError`` with an operator-readable message on any rejection.
    """

    # --- happy paths -------------------------------------------------------

    def test_parent_root_lessons(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(_validate_memory_path("memory/lessons.md"), "memory/lessons.md")

    def test_parent_root_preferences(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(
            _validate_memory_path("memory/preferences.md"), "memory/preferences.md"
        )

    def test_parent_root_contacts(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(
            _validate_memory_path("memory/contacts.md"), "memory/contacts.md"
        )

    def test_sub_agent_depth_1(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(
            _validate_memory_path("expenses/memory/lessons.md"),
            "expenses/memory/lessons.md",
        )

    def test_sub_agent_depth_2(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(
            _validate_memory_path("support/escalation/memory/lessons.md"),
            "support/escalation/memory/lessons.md",
        )

    def test_sub_agent_depth_5_max(self):
        from write_memory_tool import _validate_memory_path
        self.assertEqual(
            _validate_memory_path("a/b/c/d/e/memory/lessons.md"),
            "a/b/c/d/e/memory/lessons.md",
        )

    # --- edge cases --------------------------------------------------------

    def test_empty_string_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "empty"):
            _validate_memory_path("")

    def test_whitespace_only_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "empty"):
            _validate_memory_path("   ")

    def test_trailing_slash_rejects(self):
        """Path always ends in a basename; a trailing slash means directory."""
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/lessons.md/")

    # --- traversal & separator ---------------------------------------------

    def test_parent_traversal_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "traversal"):
            _validate_memory_path("../memory/lessons.md")

    def test_mid_traversal_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "traversal"):
            _validate_memory_path("expenses/../memory/lessons.md")

    def test_dot_segment_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "traversal"):
            _validate_memory_path("expenses/./memory/lessons.md")

    def test_leading_dot_segment_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "traversal"):
            _validate_memory_path("./memory/lessons.md")

    def test_absolute_path_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "absolute"):
            _validate_memory_path("/memory/lessons.md")

    def test_windows_separator_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "separator"):
            _validate_memory_path("expenses\\memory\\lessons.md")

    def test_double_slash_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "(double|empty segment)"):
            _validate_memory_path("expenses//memory/lessons.md")

    # --- basename allowlist ------------------------------------------------

    def test_unknown_basename_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/bogus.md")

    def test_wrong_extension_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/lessons.txt")

    def test_no_extension_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/lessons")

    def test_uppercase_basename_rejects(self):
        """Regex is lowercase-anchored; capitalised basenames don't match."""
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/Lessons.md")

    # --- reserved-name misuse ----------------------------------------------

    def test_skills_as_folder_prefix_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "reserved"):
            _validate_memory_path("skills/memory/lessons.md")

    def test_memory_doubled_as_folder_prefix_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "reserved"):
            _validate_memory_path("memory/memory/lessons.md")

    def test_skills_mid_prefix_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "reserved"):
            _validate_memory_path("expenses/skills/memory/lessons.md")

    # --- depth & shape ------------------------------------------------------

    def test_depth_6_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "(depth|exceeds)"):
            _validate_memory_path("a/b/c/d/e/f/memory/lessons.md")

    def test_suffix_extension_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/lessons.md/foo")

    def test_empty_segment_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "(double|empty segment)"):
            _validate_memory_path("a//b/memory/lessons.md")

    # --- Unicode behavior --------------------------------------------------

    def test_nfkc_fullwidth_collapses_to_canonical(self):
        """Per plan: NFKC normalises fullwidth ASCII to standard ASCII."""
        from write_memory_tool import _validate_memory_path
        # `ｍemory` (U+FF4D fullwidth m) NFKC-normalizes to `memory`.
        self.assertEqual(
            _validate_memory_path("ｍemory/lessons.md"), "memory/lessons.md"
        )

    def test_cyrillic_lookalike_rejects(self):
        """NFKC does NOT translate Cyrillic to Latin; regex rejects."""
        from write_memory_tool import _validate_memory_path
        # `memоry` contains Cyrillic small letter o (U+043E) instead of Latin o.
        with self.assertRaises(ValueError):
            _validate_memory_path("memоry/lessons.md")

    def test_embedded_space_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("mem ory/lessons.md")

    def test_trailing_basename_uppercase_after_nfkc_rejects(self):
        """NFKC doesn't lowercase; the regex anchor still rejects."""
        from write_memory_tool import _validate_memory_path
        with self.assertRaises(ValueError):
            _validate_memory_path("memory/Contacts.md")

    # --- type guards -------------------------------------------------------

    def test_none_rejects(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "empty"):
            _validate_memory_path(None)

    def test_int_rejects_with_type_message(self):
        """Per correctness review: non-str must not leak AttributeError."""
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "must be a string"):
            _validate_memory_path(42)

    def test_bytes_rejects_with_type_message(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "must be a string"):
            _validate_memory_path(b"memory/lessons.md")

    def test_list_rejects_with_type_message(self):
        from write_memory_tool import _validate_memory_path
        with self.assertRaisesRegex(ValueError, "must be a string"):
            _validate_memory_path(["memory", "lessons.md"])

    # --- NFKC fullwidth-separator behavior ---------------------------------

    def test_fullwidth_slash_normalizes_to_separator(self):
        """U+FF0F NFKC-normalizes to '/'; document this as accepted behavior.

        Catches a refactor that swaps "NFKC, then segment-check" → "segment-
        check, then NFKC" — that swap silently re-opens traversal bypasses.
        """
        from write_memory_tool import _validate_memory_path
        # `expenses／memory/lessons.md` (U+FF0F mid-path) NFKC →
        # `expenses/memory/lessons.md` and is accepted.
        self.assertEqual(
            _validate_memory_path("expenses／memory/lessons.md"),
            "expenses/memory/lessons.md",
        )

    def test_fullwidth_dot_in_segment_rejects(self):
        """U+FF0E NFKC-normalizes to '.'. After NFKC the regex rejects the bare-dot segment."""
        from write_memory_tool import _validate_memory_path
        # `．/memory/lessons.md` (U+FF0E) NFKC → `./memory/lessons.md` →
        # rejected by the dot-segment check.
        with self.assertRaisesRegex(ValueError, "traversal"):
            _validate_memory_path("．/memory/lessons.md")


# ────────────────────────────────────────────────────────────────────────────
# Tool-end integration — happy path, sub-agent path, env-strip
# ────────────────────────────────────────────────────────────────────────────


class TestWriteMemoryTool(unittest.TestCase):
    def setUp(self):
        os.environ["TENANT_ID"] = "tenant-a"
        os.environ["AGENT_ID"] = "agent-marco"
        os.environ["THINKWORK_API_URL"] = "https://api.example.test"
        os.environ["API_AUTH_SECRET"] = "test-secret"
        # Force re-import so env vars are fresh.
        for mod in ("write_memory_tool",):
            if mod in sys.modules:
                del sys.modules[mod]

    def _fake_urlopen(self, response_payload: dict, captured: list):
        def opener(req, timeout=None):
            body = req.data if hasattr(req, "data") else None
            captured.append({
                "url": req.full_url if hasattr(req, "full_url") else req.get_full_url(),
                "headers": dict(req.header_items()),
                "body": json.loads(body.decode("utf-8")) if body else None,
            })
            data = json.dumps(response_payload).encode("utf-8")
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=io.BytesIO(data))
            ctx.__exit__ = MagicMock(return_value=False)
            return ctx
        return opener

    def test_parent_root_path_posts_verbatim(self):
        """Parent agent: write_memory("memory/lessons.md", ...) lands at root."""
        from write_memory_tool import write_memory
        captured = []
        with patch("urllib.request.urlopen", self._fake_urlopen({"ok": True}, captured)):
            fn = _unwrap(write_memory)
            result = fn(path="memory/lessons.md", content="# Lessons\n- Be kind")

        self.assertIn("saved", result)
        self.assertEqual(len(captured), 1)
        body = captured[0]["body"]
        self.assertEqual(body["action"], "put")
        self.assertEqual(body["path"], "memory/lessons.md")
        self.assertEqual(body["agentId"], "agent-marco")
        self.assertEqual(body["content"], "# Lessons\n- Be kind")
        hdrs = {k.lower(): v for k, v in captured[0]["headers"].items()}
        self.assertEqual(hdrs.get("x-api-key"), "test-secret")
        self.assertEqual(hdrs.get("x-tenant-id"), "tenant-a")

    def test_sub_agent_path_posts_verbatim(self):
        """Sub-agent: write_memory("expenses/memory/lessons.md", ...) lands at sub scope."""
        from write_memory_tool import write_memory
        captured = []
        with patch("urllib.request.urlopen", self._fake_urlopen({"ok": True}, captured)):
            fn = _unwrap(write_memory)
            result = fn(path="expenses/memory/lessons.md", content="x")

        self.assertIn("saved", result)
        body = captured[0]["body"]
        self.assertEqual(body["path"], "expenses/memory/lessons.md")
        self.assertEqual(body["agentId"], "agent-marco")

    def test_invalid_path_rejected_before_http_call(self):
        """Path traversal never reaches the network."""
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        with patch("urllib.request.urlopen", side_effect=AssertionError("should not hit network")):
            result = fn(path="../GUARDRAILS.md", content="bypass")
        # Operator-readable rejection mentions traversal or invalid path.
        self.assertTrue(
            "traversal" in result or "invalid" in result.lower(),
            f"unexpected rejection message: {result!r}",
        )

    def test_reserved_prefix_rejected_before_http_call(self):
        """skills/ as a folder prefix never reaches the network."""
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        with patch("urllib.request.urlopen", side_effect=AssertionError("should not hit network")):
            result = fn(path="skills/memory/lessons.md", content="bypass")
        self.assertIn("reserved", result.lower())

    def test_unknown_basename_rejected_before_http_call(self):
        """memory/bogus.md never reaches the network — basename allowlist."""
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        with patch("urllib.request.urlopen", side_effect=AssertionError("should not hit network")):
            result = fn(path="memory/bogus.md", content="bypass")
        # Tool body returns the validator's ValueError text on rejection.
        self.assertTrue(
            "invalid" in result.lower() or "bogus" in result.lower(),
            f"unexpected rejection message: {result!r}",
        )

    def test_missing_runtime_config_returns_error_without_crashing(self):
        # Strip env so the runtime-config check fails.
        for var in ("TENANT_ID", "AGENT_ID", "THINKWORK_API_URL",
                    "API_AUTH_SECRET", "THINKWORK_API_SECRET"):
            os.environ.pop(var, None)
        # Also strip the _MCP_* fallbacks.
        os.environ.pop("_MCP_TENANT_ID", None)
        os.environ.pop("_MCP_AGENT_ID", None)
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        result = fn(path="memory/lessons.md", content="x")
        self.assertIn("missing tenant / agent / API config", result)

    def test_non_string_path_returns_operator_error(self):
        """Per correctness review: non-str path must not leak through @tool.

        Asserts the integration boundary swallows the validator's typed
        ValueError into the standard `write_memory: ...` error string,
        rather than escaping as AttributeError/TypeError.
        """
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        result = fn(path=42, content="x")
        self.assertTrue(
            result.startswith("write_memory: "),
            f"unexpected error envelope: {result!r}",
        )
        self.assertIn("must be a string", result)

    def test_http_error_returns_save_failed(self):
        """Per testing review: HTTPError catch in tool body has no test."""
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        # urlopen raises HTTPError directly to exercise the
        # `except urllib.error.HTTPError` branch.
        import urllib.error
        err = urllib.error.HTTPError(
            url="https://api.example.test/api/workspaces/files",
            code=500,
            msg="Server Error",
            hdrs=None,  # type: ignore[arg-type]
            fp=io.BytesIO(b'{"error": "boom"}'),
        )
        with patch("urllib.request.urlopen", side_effect=err):
            result = fn(path="memory/lessons.md", content="x")
        self.assertIn("save failed", result)

    def test_composer_not_ok_returns_save_failed(self):
        """Per testing review: `_post_put` `payload.get('ok') is False` is untested."""
        from write_memory_tool import write_memory
        fn = _unwrap(write_memory)
        captured: list = []
        with patch(
            "urllib.request.urlopen",
            self._fake_urlopen({"ok": False, "error": "denied"}, captured),
        ):
            result = fn(path="memory/lessons.md", content="x")
        self.assertIn("save failed", result)
        self.assertIn("denied", result)


# ────────────────────────────────────────────────────────────────────────────
# @tool schema — pin the path/content rename to lock in the U12 contract
# ────────────────────────────────────────────────────────────────────────────


class TestWriteMemoryToolSchema(unittest.TestCase):
    """Per testing review: `_unwrap` bypasses the @tool surface, so the
    schema rename `name` → `path` is never asserted by integration tests.
    Pin it here so a silent regression on the LLM-facing parameter name
    fails this test file rather than reaching production.
    """

    def test_tool_schema_uses_path_not_name(self):
        # Force re-import so the @tool decorator runs against the current source.
        for mod in ("write_memory_tool",):
            if mod in sys.modules:
                del sys.modules[mod]
        from write_memory_tool import write_memory
        spec = getattr(write_memory, "tool_spec", None) or getattr(
            write_memory, "spec", None
        )
        if spec is None:
            self.skipTest(
                "Strands @tool exposes no inspectable spec on this version; "
                "the docstring contract is the public surface here."
            )
        # Walk to the JSON-Schema input properties regardless of which
        # version of strands-agents shaped the spec.
        properties: dict = {}
        if isinstance(spec, dict):
            schema = (
                spec.get("inputSchema")
                or spec.get("input_schema")
                or {}
            )
            if isinstance(schema, dict):
                payload = schema.get("json") or schema
                if isinstance(payload, dict):
                    properties = payload.get("properties") or {}
        self.assertIn(
            "path", properties,
            f"@tool schema is missing the U12 `path` parameter — got {sorted(properties)}",
        )
        self.assertNotIn(
            "name", properties,
            "@tool schema still has the old `name` parameter — schema rename did not land",
        )


if __name__ == "__main__":
    unittest.main()
