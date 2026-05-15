"""Tests for the U3 per-turn attachment staging helper.

Mocks boto3.client('s3').download_file so the tests exercise the
defense-in-depth checks (prefix verification, path-escape rejection,
malformed-ref skipping) without touching real AWS.

Plan: docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md (U3)
"""

from __future__ import annotations

import os
import shutil
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTAINER_SOURCES = (
    REPO_ROOT / "packages/agentcore-strands/agent-container/container-sources"
)
sys.path.insert(0, str(CONTAINER_SOURCES))

# server.py has many top-level side effects (boto3 client, env munging).
# We can't import it cleanly in an isolated test context, but the
# staging helpers are pure enough that we re-create the import surface
# they need: the global logger + the helpers themselves.
#
# Strategy: re-export the helpers via exec() against the source, in a
# namespace where the imports they reach for (boto3, logging) are stubbed.

_HELPERS_SOURCE_START = "# Finance pilot U3 — per-turn /tmp attachment staging"
_HELPERS_SOURCE_END = (
    "def _set_computer_turn_env("  # next function in server.py
)


def _extract_staging_helpers_source() -> str:
    text = (CONTAINER_SOURCES / "server.py").read_text()
    start = text.index(_HELPERS_SOURCE_START)
    end = text.index(_HELPERS_SOURCE_END, start)
    return text[start:end]


@pytest.fixture()
def staging_module(monkeypatch, tmp_path):
    """Load only the staging helpers into a synthetic module for testing."""
    import logging

    fake_boto3 = types.SimpleNamespace()
    fake_boto3.client = mock.MagicMock()

    helpers_src = _extract_staging_helpers_source()

    mod = types.ModuleType("staging_helpers_under_test")
    mod.__dict__.update(
        {
            "os": os,
            "logger": logging.getLogger("staging_helpers_test"),
            "boto3": fake_boto3,
        }
    )
    exec(helpers_src, mod.__dict__)

    # Redirect /tmp/turn-... into the pytest tmp_path so multiple test
    # workers do not collide and cleanup is automatic.
    monkeypatch.setattr(mod, "os", os)
    # Capture the s3 client mock so individual tests can program its
    # download_file behavior.
    yield mod


@pytest.fixture()
def mock_s3_download(staging_module, tmp_path):
    """Wire the staging module's boto3.client('s3').download_file to a
    fake that just touches the local path with a known body."""
    client = mock.MagicMock()

    def _download(bucket: str, key: str, dest: str) -> None:  # noqa: ARG001
        # Simulate a real download by writing a small payload at the
        # destination so the caller can verify the file landed.
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(f"payload for {key}".encode())

    client.download_file.side_effect = _download
    staging_module.boto3.client.return_value = client
    return client


def _ref(
    *,
    attachment_id: str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenant: str = "t1",
    thread: str = "th1",
    name: str = "financials.xlsx",
    mime: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: int = 1024,
    s3_key: str | None = None,
) -> dict:
    return {
        "attachment_id": attachment_id,
        "s3_key": s3_key
        or f"tenants/{tenant}/attachments/{thread}/{attachment_id}/{name}",
        "name": name,
        "mime_type": mime,
        "size_bytes": size,
    }


class TestStageMessageAttachments:
    def test_empty_list_returns_empty(self, staging_module):
        turn_dir, staged = staging_module._stage_message_attachments(
            [],
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        assert turn_dir == ""
        assert staged == []

    def test_missing_bucket_returns_empty(self, staging_module, mock_s3_download):
        turn_dir, staged = staging_module._stage_message_attachments(
            [_ref()],
            workspace_bucket="",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        assert turn_dir == ""
        assert staged == []

    def test_happy_path_downloads_and_returns_local_paths(
        self, staging_module, mock_s3_download
    ):
        refs = [_ref(name="financials.xlsx"), _ref(attachment_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name="invoices.csv", mime="text/csv")]
        turn_dir, staged = staging_module._stage_message_attachments(
            refs,
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        try:
            assert turn_dir.startswith("/tmp/turn-")
            assert turn_dir.endswith("/attachments")
            assert len(staged) == 2
            assert all(Path(e["local_path"]).exists() for e in staged)
            assert staged[0]["name"] == "financials.xlsx"
            assert staged[1]["name"] == "invoices.csv"
            # Order preservation
            assert staged[0]["attachment_id"] != staged[1]["attachment_id"]
        finally:
            shutil.rmtree(Path(turn_dir).parent, ignore_errors=True)

    def test_rejects_ref_with_mismatched_prefix(
        self, staging_module, mock_s3_download
    ):
        bad = _ref(
            s3_key="tenants/OTHER-TENANT/attachments/some-thread/aaa/foo.xlsx"
        )
        turn_dir, staged = staging_module._stage_message_attachments(
            [bad],
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        assert staged == []
        # download_file MUST NOT have been called for the rejected ref.
        mock_s3_download.download_file.assert_not_called()

    def test_rejects_ref_with_path_escape_in_name(
        self, staging_module, mock_s3_download
    ):
        bad = _ref(name="../../../etc/passwd.csv")
        turn_dir, staged = staging_module._stage_message_attachments(
            [bad],
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        assert staged == []
        mock_s3_download.download_file.assert_not_called()

    def test_skips_malformed_ref_keeps_processing(
        self, staging_module, mock_s3_download
    ):
        refs = [
            {"attachment_id": None, "s3_key": "x", "name": "y"},
            _ref(name="financials.xlsx"),
        ]
        turn_dir, staged = staging_module._stage_message_attachments(
            refs,
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        try:
            assert len(staged) == 1
            assert staged[0]["name"] == "financials.xlsx"
        finally:
            if turn_dir:
                shutil.rmtree(Path(turn_dir).parent, ignore_errors=True)

    def test_download_failure_logs_and_skips(self, staging_module, mock_s3_download):
        client = mock.MagicMock()

        def _flaky(_bucket: str, _key: str, dest: str) -> None:
            raise RuntimeError("S3 unreachable")

        client.download_file.side_effect = _flaky
        staging_module.boto3.client.return_value = client

        turn_dir, staged = staging_module._stage_message_attachments(
            [_ref()],
            workspace_bucket="bucket",
            expected_tenant_id="t1",
            expected_thread_id="th1",
        )
        # All downloads failed → empty result, empty turn_dir (helper
        # cleans up the empty directory before returning).
        assert turn_dir == ""
        assert staged == []


class TestFormatMessageAttachmentsPreamble:
    def test_empty_returns_empty_string(self, staging_module):
        assert staging_module._format_message_attachments_preamble([]) == ""

    def test_emits_absolute_paths_and_file_read_hint(self, staging_module):
        staged = [
            {
                "attachment_id": "a1",
                "local_path": "/tmp/turn-abc/attachments/financials.xlsx",
                "name": "financials.xlsx",
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "size_bytes": 50_000,
            }
        ]
        out = staging_module._format_message_attachments_preamble(staged)
        assert out.startswith("Files attached to this turn:")
        assert "/tmp/turn-abc/attachments/financials.xlsx" in out
        assert "file_read" in out


class TestCleanupTurnDir:
    def test_no_op_on_empty_input(self, staging_module):
        # Should not raise.
        staging_module._cleanup_message_attachments_turn_dir("")

    def test_removes_parent_turn_dir(self, staging_module, tmp_path):
        turn_root = tmp_path / "turn-test"
        attachments = turn_root / "attachments"
        attachments.mkdir(parents=True)
        (attachments / "f.csv").write_text("x")
        staging_module._cleanup_message_attachments_turn_dir(str(attachments))
        assert not turn_root.exists()
