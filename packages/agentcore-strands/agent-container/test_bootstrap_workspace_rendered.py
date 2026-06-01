"""Rendered tuple prefix tests for bootstrap_workspace."""

from __future__ import annotations

import json
import os
import sys

_CONTAINER_SOURCES = os.path.join(os.path.dirname(__file__), "container-sources")
if _CONTAINER_SOURCES not in sys.path:
    sys.path.insert(0, _CONTAINER_SOURCES)

from bootstrap_workspace import bootstrap_workspace  # type: ignore  # noqa: E402


class FakeS3:
    def __init__(self, store: dict[str, bytes]):
        self._store = store
        self.list_calls: list[dict] = []
        self.get_calls: list[str] = []

    def list_objects_v2(self, **params):
        self.list_calls.append(params)
        prefix = params.get("Prefix", "")
        return {
            "Contents": [
                {"Key": key, "Size": len(value)}
                for key, value in self._store.items()
                if key.startswith(prefix)
            ],
            "IsTruncated": False,
        }

    def get_object(self, **params):
        self.get_calls.append(params["Key"])
        body = self._store[params["Key"]]

        class _Body:
            def read(self) -> bytes:
                return body

        return {"Body": _Body()}


def test_uses_rendered_tuple_prefix_when_flag_template_is_set(tmp_path):
    rendered_prefix = "tenants/acme/rendered/marco/default/eric/"
    s3 = FakeS3(
        {
            f"{rendered_prefix}AGENTS.md": b"# Rendered map",
            f"{rendered_prefix}SPACE.md": b"# Default Space",
            "tenants/acme/agents/marco/workspace/AGENTS.md": b"# Legacy map",
        }
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="workspace-bucket",
        rendered_workspace_prefix=rendered_prefix,
        rendered_workspace_prefix_template="tenants/{tenantSlug}/rendered/{agentSlug}/{spaceSlug}/{userSlug}/",
    )

    assert result.synced == 2
    assert s3.list_calls[0]["Prefix"] == rendered_prefix
    assert (tmp_path / "AGENTS.md").read_text() == "# Rendered map"
    assert (tmp_path / "SPACE.md").read_text() == "# Default Space"


def test_hydrates_rendered_tuple_manifest_into_v1_workspace_tree(tmp_path):
    rendered_prefix = "tenants/acme/threads/customer-kickoff/"
    manifest = {
        "version": 1,
        "renderedPrefix": rendered_prefix,
        "generatedAt": "2026-06-01T12:00:00.000Z",
        "files": [
            {
                "path": "AGENTS.md",
                "sourceKey": "tenants/acme/agents/marco/AGENTS.md",
            },
            {
                "path": "Agent/workspace/LEGACY.md",
                "sourceKey": "tenants/acme/agents/marco/workspace/LEGACY.md",
            },
            {
                "path": "Agent/workspace-archives/old.md",
                "sourceKey": "tenants/acme/agents/marco/workspace-archives/old.md",
            },
            {
                "path": "Spaces/INDEX.md",
                "sourceKey": f"{rendered_prefix}Spaces/INDEX.md",
                "readOnly": True,
                "generated": True,
            },
            {
                "path": "Spaces/default/source/CONTEXT.md",
                "sourceKey": "tenants/acme/spaces/default/source/CONTEXT.md",
            },
            {
                "path": "User/workspace/USER.md",
                "sourceKey": "tenants/acme/users/eric/workspace/USER.md",
            },
        ],
        "statusMounts": [
            {
                "path": "Thread/PROGRESS.md",
                "available": True,
                "sourceKey": f"{rendered_prefix}PROGRESS.md",
            }
        ],
    }
    s3 = FakeS3(
        {
            f"{rendered_prefix}.hydrate_manifest.json": json.dumps(manifest).encode(),
            "tenants/acme/agents/marco/AGENTS.md": b"# Agent",
            "tenants/acme/agents/marco/workspace/LEGACY.md": b"# Legacy",
            "tenants/acme/agents/marco/workspace-archives/old.md": b"# Old",
            f"{rendered_prefix}Spaces/INDEX.md": b"# Spaces",
            "tenants/acme/spaces/default/source/CONTEXT.md": b"# Space",
            "tenants/acme/users/eric/workspace/USER.md": b"# User",
            f"{rendered_prefix}PROGRESS.md": b"# Progress",
        }
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="workspace-bucket",
        rendered_workspace_prefix=rendered_prefix,
        rendered_workspace_prefix_template="tenants/{tenantSlug}/threads/{threadSlug}/",
    )

    assert result.synced == 6
    assert result.total == 6
    assert (tmp_path / "AGENTS.md").read_text() == "# Agent"
    assert (tmp_path / "LEGACY.md").read_text() == "# Legacy"
    assert (tmp_path / "Spaces" / "INDEX.md").read_text() == "# Spaces"
    assert (tmp_path / "Spaces" / "default" / "CONTEXT.md").read_text() == "# Space"
    assert (tmp_path / "User" / "USER.md").read_text() == "# User"
    assert (tmp_path / "Thread" / "PROGRESS.md").read_text() == "# Progress"
    assert not (tmp_path / "Agent").exists()
    assert not (tmp_path / "Space").exists()
    assert not (tmp_path / "USER.md").exists()
    assert not (tmp_path / "workspace-archives").exists()


def test_falls_back_to_legacy_prefix_when_flag_template_is_absent(tmp_path):
    legacy_prefix = "tenants/acme/agents/marco/workspace/"
    rendered_prefix = "tenants/acme/rendered/marco/default/eric/"
    s3 = FakeS3(
        {
            f"{legacy_prefix}AGENTS.md": b"# Legacy map",
            f"{rendered_prefix}AGENTS.md": b"# Rendered map",
        }
    )

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="workspace-bucket",
        rendered_workspace_prefix=rendered_prefix,
    )

    assert result.synced == 1
    assert s3.list_calls[0]["Prefix"] == legacy_prefix
    assert (tmp_path / "AGENTS.md").read_text() == "# Legacy map"


def test_template_flag_without_renderer_prefix_keeps_legacy_prefix(tmp_path):
    legacy_prefix = "tenants/acme/agents/marco/workspace/"
    s3 = FakeS3({f"{legacy_prefix}AGENTS.md": b"# Legacy"})

    result = bootstrap_workspace(
        tenant_slug="acme",
        agent_slug="marco",
        local_dir=str(tmp_path),
        s3_client=s3,
        bucket="workspace-bucket",
        rendered_workspace_prefix_template="tenants/{tenantSlug}/rendered/{agentSlug}/{spaceSlug}/{userSlug}/",
    )

    assert result.synced == 1
    assert s3.list_calls[0]["Prefix"] == legacy_prefix
    assert (tmp_path / "AGENTS.md").read_text() == "# Legacy"
