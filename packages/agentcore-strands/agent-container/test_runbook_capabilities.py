from __future__ import annotations

import pytest
from runbook_capabilities import (
    RunbookCapabilityError,
    resolve_runbook_capability,
    resolve_task_capabilities,
)


def test_artifact_build_maps_to_main_computer_artifact_path():
    mapping = resolve_runbook_capability("artifact_build", task_id="task-1")

    assert mapping["role"] == "artifact_build"
    assert mapping["executionTarget"] == "main_computer_agent"
    assert "save_app" in mapping["preferredTools"]
    assert "specialist" not in str(mapping).lower()


def test_unknown_capability_role_names_role_and_task():
    with pytest.raises(RunbookCapabilityError) as exc:
        resolve_runbook_capability("warehouse_magic", task_id="task-9")

    assert "warehouse_magic" in str(exc.value)
    assert "task-9" in str(exc.value)


def test_task_capabilities_require_declared_roles():
    with pytest.raises(RunbookCapabilityError) as exc:
        resolve_task_capabilities({"id": "task-1", "taskKey": "discover:1"})

    assert "discover:1" in str(exc.value) or "task-1" in str(exc.value)
