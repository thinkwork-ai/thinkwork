"""Rendered tuple prefix tests for bootstrap_workspace."""

from __future__ import annotations

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
