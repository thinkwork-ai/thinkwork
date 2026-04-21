"""Tests for Unit 7 — composer-backed workspace bootstrap.

Targets workspace_composer_client.py so we don't pull in the full Strands
runtime. The higher-level _ensure_workspace_ready in server.py is a thin
orchestrator over these helpers; correctness of the HTTP shape and disk
writes is covered here.

Run with:
    uv run --no-project --with pytest \\
        pytest packages/agentcore-strands/agent-container/test_workspace_composer_fetch.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workspace_composer_client import (  # noqa: E402
    compute_fingerprint,
    fetch_composed_workspace,
    write_composed_to_dir,
)


def _fake_urlopen(response_payload: dict, captured: list):
    def opener(req, timeout=None):
        body = req.data if hasattr(req, "data") else None
        captured.append({
            "url": req.full_url if hasattr(req, "full_url") else req.get_full_url(),
            "method": req.get_method(),
            "headers": dict(req.header_items()),
            "body": json.loads(body.decode("utf-8")) if body else None,
            "timeout": timeout,
        })
        data = json.dumps(response_payload).encode("utf-8")
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=io.BytesIO(data))
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx
    return opener


class TestFetchComposedWorkspace(unittest.TestCase):
    def test_posts_to_correct_url_with_service_auth_headers_and_body(self):
        captured = []
        response = {
            "ok": True,
            "files": [
                {"path": "SOUL.md", "source": "defaults", "sha256": "abc", "content": "Hi"},
            ],
        }
        with patch("urllib.request.urlopen", _fake_urlopen(response, captured)):
            files = fetch_composed_workspace(
                tenant_id="tenant-a",
                agent_id="agent-marco",
                api_url="https://api.example.test",
                api_secret="test-secret",
            )

        self.assertEqual(len(captured), 1)
        call = captured[0]
        self.assertEqual(call["method"], "POST")
        self.assertTrue(call["url"].endswith("/api/workspaces/files"))
        hdrs = {k.lower(): v for k, v in call["headers"].items()}
        self.assertEqual(hdrs.get("x-api-key"), "test-secret")
        self.assertEqual(hdrs.get("x-tenant-id"), "tenant-a")
        self.assertEqual(call["body"]["agentId"], "agent-marco")
        self.assertEqual(call["body"]["action"], "list")
        self.assertIs(call["body"]["includeContent"], True)
        self.assertEqual(len(files), 1)

    def test_strips_trailing_slash_from_api_url(self):
        captured = []
        with patch("urllib.request.urlopen", _fake_urlopen({"ok": True, "files": []}, captured)):
            fetch_composed_workspace(
                tenant_id="t",
                agent_id="a",
                api_url="https://api.example.test/",
                api_secret="s",
            )
        self.assertTrue(captured[0]["url"].endswith("/api/workspaces/files"))
        # No double slash
        self.assertNotIn("//api/workspaces/", captured[0]["url"].replace("https://", ""))

    def test_missing_config_raises_cleanly(self):
        with self.assertRaises(RuntimeError):
            fetch_composed_workspace("", "a", "u", "s")
        with self.assertRaises(RuntimeError):
            fetch_composed_workspace("t", "", "u", "s")
        with self.assertRaises(RuntimeError):
            fetch_composed_workspace("t", "a", "", "s")
        with self.assertRaises(RuntimeError):
            fetch_composed_workspace("t", "a", "u", "")

    def test_composer_error_response_raises(self):
        with patch("urllib.request.urlopen", _fake_urlopen(
            {"ok": False, "error": "Target not found"}, [],
        )):
            with self.assertRaises(RuntimeError) as cm:
                fetch_composed_workspace("t", "a", "https://u.example.test", "s")
            self.assertIn("Target not found", str(cm.exception))

    def test_module_does_not_import_boto3(self):
        """S3 PUT guard: the composer-fetch module must not reach for S3.

        Documents the Unit 7 invariant — no more S3 reads / writes from the
        bootstrap path. Verified by inspecting the module's imports rather
        than patching boto3 (which may not be installed in the test env).
        """
        import workspace_composer_client as wcc
        # The module's own __dict__ should not contain a reference to the
        # boto3 module.
        self.assertNotIn("boto3", wcc.__dict__)
        self.assertNotIn("S3Client", wcc.__dict__)


class TestWriteComposedToDir(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="strands-ws-test-")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_writes_top_level_and_nested_files(self):
        files = [
            {"path": "SOUL.md", "content": "Hi"},
            {"path": "memory/lessons.md", "content": "# Lessons\n"},
        ]
        written = write_composed_to_dir(files, self.tmpdir)
        self.assertEqual(written, 2)
        with open(os.path.join(self.tmpdir, "SOUL.md")) as f:
            self.assertEqual(f.read(), "Hi")
        with open(os.path.join(self.tmpdir, "memory", "lessons.md")) as f:
            self.assertEqual(f.read(), "# Lessons\n")

    def test_skips_files_without_content(self):
        files = [
            {"path": "SOUL.md", "content": "ok"},
            {"path": "IDENTITY.md"},  # missing content
            {"path": "", "content": "noop"},  # empty path
        ]
        written = write_composed_to_dir(files, self.tmpdir)
        self.assertEqual(written, 1)

    def test_strips_leading_slash_to_prevent_absolute_write(self):
        files = [{"path": "/etc/passwd", "content": "nope"}]
        written = write_composed_to_dir(files, self.tmpdir)
        self.assertEqual(written, 1)
        # Writes under tmpdir, not /etc
        self.assertTrue(os.path.exists(os.path.join(self.tmpdir, "etc", "passwd")))
        self.assertFalse(os.path.exists("/etc/passwd_test_unit_7"))


class TestComputeFingerprint(unittest.TestCase):
    def test_same_files_same_fingerprint(self):
        a = [{"path": "SOUL.md", "sha256": "abc"}]
        b = [{"path": "SOUL.md", "sha256": "abc"}]
        self.assertEqual(compute_fingerprint(a), compute_fingerprint(b))

    def test_content_change_changes_fingerprint(self):
        a = [{"path": "SOUL.md", "sha256": "abc"}]
        b = [{"path": "SOUL.md", "sha256": "def"}]
        self.assertNotEqual(compute_fingerprint(a), compute_fingerprint(b))


if __name__ == "__main__":
    unittest.main()
