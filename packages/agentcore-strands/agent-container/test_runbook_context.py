from __future__ import annotations

import pytest
from runbook_context import (
    RunbookContextError,
    build_runbook_queue_part,
    format_runbook_context,
)


def _context():
    return {
        "taskId": "computer-task-1",
        "run": {
            "id": "run-1",
            "status": "running",
            "runbookSlug": "research-dashboard",
            "runbookVersion": "0.1.0",
        },
        "definitionSnapshot": {
            "catalog": {"displayName": "Research Dashboard"},
            "skill": {
                "skillMdPath": "skills/research-dashboard/SKILL.md",
                "skillMdSha256": "a" * 64,
                "skillBody": "Use this skill to build a research dashboard from evidence.",
                "contractPath": "references/thinkwork-runbook.json",
                "contractSha256": "b" * 64,
                "assetRefs": ["assets/research-dashboard.schema.json"],
            },
            "phases": [
                {
                    "id": "discover",
                    "title": "Discover evidence",
                    "guidance": "discover.md",
                    "guidanceMarkdown": "Find sources and capture confidence.",
                },
                {
                    "id": "produce",
                    "title": "Produce dashboard",
                    "guidance": "produce.md",
                    "guidanceMarkdown": "Build and save the dashboard artifact.",
                },
            ],
            "outputs": [
                {
                    "id": "dashboard_artifact",
                    "title": "Dashboard artifact",
                    "type": "artifact",
                    "description": "A saved dashboard app.",
                }
            ],
        },
        "tasks": [
            {
                "id": "task-discover",
                "phaseId": "discover",
                "phaseTitle": "Discover evidence",
                "taskKey": "discover:1",
                "title": "Identify sources",
                "status": "completed",
                "dependsOn": [],
                "capabilityRoles": ["research"],
                "sortOrder": 1,
                "output": {"sources": ["workspace"]},
            },
            {
                "id": "task-produce",
                "phaseId": "produce",
                "phaseTitle": "Produce dashboard",
                "taskKey": "produce:1",
                "title": "Create the dashboard",
                "status": "running",
                "dependsOn": ["discover:1"],
                "capabilityRoles": ["artifact_build"],
                "sortOrder": 2,
            },
        ],
        "previousOutputs": {"discover:1": {"sources": ["workspace"]}},
    }


def test_format_runbook_context_includes_task_handoff_and_output_contract():
    rendered = format_runbook_context(_context())

    assert "## Runbook Execution Context" in rendered
    assert "Research Dashboard" in rendered
    assert "skills/research-dashboard/SKILL.md" in rendered
    assert "`" + "a" * 64 + "`" in rendered
    assert "Use this skill to build a research dashboard from evidence." in rendered
    assert "`assets/research-dashboard.schema.json`" in rendered
    assert "Create the dashboard" in rendered
    assert "Build and save the dashboard artifact." in rendered
    assert "Find sources and capture confidence." not in rendered
    assert '"discover:1"' in rendered
    assert "Dashboard artifact" in rendered
    assert "`artifact_build` -> `main_computer_agent`" in rendered


def test_missing_prior_output_fails_before_model_call():
    context = _context()
    context["previousOutputs"] = {}

    with pytest.raises(RunbookContextError) as exc:
        format_runbook_context(context)

    assert "produce:1" in str(exc.value)
    assert "discover:1" in str(exc.value)


def test_unknown_capability_role_fails_with_task_identifier():
    context = _context()
    context["tasks"][1]["capabilityRoles"] = ["unknown_role"]

    with pytest.raises(ValueError) as exc:
        format_runbook_context(context)

    assert "unknown_role" in str(exc.value)
    assert "task-produce" in str(exc.value)


def test_build_runbook_queue_part_uses_generic_task_queue_shape():
    part = build_runbook_queue_part(_context())

    assert part["type"] == "data-task-queue"
    assert part["id"] == "task-queue:run-1"
    assert part["data"]["queueId"] == "run-1"
    assert part["data"]["source"]["type"] == "runbook"
    assert part["data"]["groups"][1]["items"][0]["status"] == "running"
    assert part["data"]["groups"][1]["items"][0]["metadata"]["taskKey"] == "produce:1"
