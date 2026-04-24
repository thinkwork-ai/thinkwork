"""Tests for Unit 7 — the write_memory Strands tool.

Verifies the basename-enum boundary rejects unknown names, and that a
valid name produces the correct POST to /api/workspaces/files.

Run with:
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

    def test_valid_basename_posts_with_memory_prefix(self):
        from write_memory_tool import write_memory
        captured = []
        with patch("urllib.request.urlopen", self._fake_urlopen({"ok": True}, captured)):
            # write_memory is a @tool-decorated callable. Strands wraps it
            # but the underlying function is still callable for tests.
            fn = getattr(write_memory, "original_func", None) or getattr(write_memory, "__wrapped__", None) or write_memory
            result = fn(name="lessons.md", content="# Lessons\n- Be kind")

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

    def test_invalid_basename_rejected_before_http_call(self):
        from write_memory_tool import write_memory
        fn = getattr(write_memory, "original_func", None) or getattr(write_memory, "__wrapped__", None) or write_memory
        with patch("urllib.request.urlopen", side_effect=AssertionError("should not hit network")):
            # An escaping attempt that the enum catches at the boundary.
            result = fn(name="../GUARDRAILS.md", content="bypass")
        self.assertIn("not an accepted basename", result)

    def test_missing_runtime_config_returns_error_without_crashing(self):
        # Strip env so the runtime-config check fails.
        for var in ("TENANT_ID", "AGENT_ID", "THINKWORK_API_URL",
                    "API_AUTH_SECRET", "THINKWORK_API_SECRET"):
            os.environ.pop(var, None)
        # Also strip the _MCP_* fallbacks.
        os.environ.pop("_MCP_TENANT_ID", None)
        os.environ.pop("_MCP_AGENT_ID", None)
        from write_memory_tool import write_memory
        fn = getattr(write_memory, "original_func", None) or getattr(write_memory, "__wrapped__", None) or write_memory
        result = fn(name="lessons.md", content="x")
        self.assertIn("missing tenant / agent / API config", result)


if __name__ == "__main__":
    unittest.main()
