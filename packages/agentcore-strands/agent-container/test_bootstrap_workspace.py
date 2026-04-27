"""Tests for bootstrap_workspace — the flat S3-prefix sync.

Contract under test (intentionally narrow):
- Lists the agent's S3 prefix.
- Downloads every file (skipping manifest.json and _defaults_version).
- Deletes local files that disappeared upstream.
- Returns counts for caller logging.

If a test ever starts asserting "skip unchanged files via ETag" or
"fall back to template prefix" we re-introduced complexity we
explicitly removed.
"""

from __future__ import annotations

import os
import sys

import pytest

# The container's source files live in container-sources/ but pytest
# imports relative to the package dir; mirror what test_server*.py does.
_CONTAINER_SOURCES = os.path.join(os.path.dirname(__file__), "container-sources")
if _CONTAINER_SOURCES not in sys.path:
    sys.path.insert(0, _CONTAINER_SOURCES)

from bootstrap_workspace import (  # type: ignore  # noqa: E402
    BootstrapResult,
    bootstrap_workspace,
)

# ----------------------------------------------------------------------
# Stub S3 client
# ----------------------------------------------------------------------


class FakeS3:
    def __init__(self, store: dict[str, bytes]):
        # store is keyed by full S3 Key
        self._store = store
        self.list_calls: list[dict] = []
        self.get_calls: list[str] = []

    def list_objects_v2(self, **params):
        self.list_calls.append(params)
        prefix = params.get("Prefix", "")
        contents = [
            {"Key": k, "Size": len(v), "ETag": '"etag"'}
            for k, v in self._store.items()
            if k.startswith(prefix)
        ]
        return {"Contents": contents, "IsTruncated": False}

    def get_object(self, **params):
        self.get_calls.append(params["Key"])
        body = self._store.get(params["Key"])
        if body is None:
            err = Exception("NoSuchKey")
            err.name = "NoSuchKey"  # type: ignore[attr-defined]
            raise err

        class _Body:
            def __init__(self, data: bytes) -> None:
                self._data = data

            def read(self) -> bytes:
                return self._data

        return {"Body": _Body(body)}


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

PREFIX = "tenants/acme/agents/marco/workspace/"


def _store(**files: str) -> dict[str, bytes]:
    """Build an S3 store keyed by relative path under the agent prefix."""
    return {PREFIX + rel: content.encode("utf-8") for rel, content in files.items()}


# ----------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------


def test_downloads_every_remote_file_into_local_dir(tmp_path):
    s3 = FakeS3(
        _store(
            **{
                "AGENTS.md": "# Marco of Acme",
                "IDENTITY.md": "I am Marco.",
                "memory/decisions.md": "yo",
            },
        ),
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result == BootstrapResult(synced=3, deleted=0, total=3)
    assert (tmp_path / "AGENTS.md").read_text() == "# Marco of Acme"
    assert (tmp_path / "IDENTITY.md").read_text() == "I am Marco."
    assert (tmp_path / "memory" / "decisions.md").read_text() == "yo"


def test_skips_manifest_and_defaults_version_artifacts(tmp_path):
    s3 = FakeS3(
        _store(
            **{
                "AGENTS.md": "real",
                "manifest.json": "should-skip",
                "_defaults_version": "should-skip",
            },
        ),
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result.synced == 1
    assert result.total == 1
    assert (tmp_path / "AGENTS.md").read_text() == "real"
    assert not (tmp_path / "manifest.json").exists()
    assert not (tmp_path / "_defaults_version").exists()


def test_deletes_locals_that_are_absent_in_s3(tmp_path):
    # Pre-populate local with two files; only one is in S3.
    (tmp_path / "AGENTS.md").write_text("local-only-stale")
    (tmp_path / "stale.md").write_text("delete me")
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "old.md").write_text("delete me too")

    s3 = FakeS3(_store(**{"AGENTS.md": "fresh remote"}))

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result.synced == 1
    assert result.deleted == 2
    assert (tmp_path / "AGENTS.md").read_text() == "fresh remote"
    assert not (tmp_path / "stale.md").exists()
    assert not (tmp_path / "memory" / "old.md").exists()
    # Empty parent dir was tidied
    assert not (tmp_path / "memory").exists()


def test_overwrites_local_files_with_remote_bytes(tmp_path):
    (tmp_path / "AGENTS.md").write_text("old local")

    s3 = FakeS3(_store(**{"AGENTS.md": "new remote"}))

    bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert (tmp_path / "AGENTS.md").read_text() == "new remote"


def test_creates_local_dir_if_missing(tmp_path):
    target = tmp_path / "nope" / "ws"
    s3 = FakeS3(_store(**{"AGENTS.md": "x"}))

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(target),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result.synced == 1
    assert (target / "AGENTS.md").read_text() == "x"


def test_empty_remote_returns_zero_synced(tmp_path):
    s3 = FakeS3({})  # nothing under any prefix

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result == BootstrapResult(synced=0, deleted=0, total=0)


def test_does_not_touch_other_agents_prefix(tmp_path):
    s3 = FakeS3(
        {
            **_store(**{"AGENTS.md": "marco's"}),
            "tenants/acme/agents/finny/workspace/AGENTS.md": b"finny's",
        },
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="test-bucket",
    )

    assert result.synced == 1
    assert (tmp_path / "AGENTS.md").read_text() == "marco's"
