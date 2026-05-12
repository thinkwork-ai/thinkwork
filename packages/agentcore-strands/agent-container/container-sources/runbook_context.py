"""Runbook execution context formatting for the Strands runtime."""

from __future__ import annotations

import json
from typing import Any

from runbook_capabilities import resolve_task_capabilities

MAX_PREVIOUS_OUTPUT_TEXT_CHARS = 1500
MAX_PREVIOUS_OUTPUT_JSON_CHARS = 4000


class RunbookContextError(ValueError):
    """Raised when runtime-supplied runbook context is incomplete or unsafe."""


def format_runbook_context(runbook_context: Any) -> str:
    """Render current runbook task context as a system-prompt section.

    Returns an empty string when no runbook context is present. When context is
    present, validation is intentionally strict because errors should surface
    before the model call rather than after a task has improvised around a bad
    handoff.
    """

    if not isinstance(runbook_context, dict):
        return ""

    normalized = _normalize_context(runbook_context)
    current_task = normalized["currentTask"]
    current_phase = normalized["currentPhase"]
    run = normalized["run"]
    definition = normalized["definition"]
    skill = _skill_snapshot(definition)
    previous_outputs = normalized["previousOutputs"]
    capability_mappings = resolve_task_capabilities(current_task)

    _assert_dependencies_available(current_task, previous_outputs)

    lines: list[str] = [
        "## Runbook Execution Context",
        "",
        "A ThinkWork runbook is active. The runbook definition is the source",
        "of truth; Strands is only the execution target. Execute exactly the",
        "current task, preserve the runbook phase/task semantics, and pass",
        "task outputs forward through the runtime instead of inventing a",
        "separate workflow.",
        "",
        f"- **Runbook:** {_display_name(definition, run)} (`{run['runbookSlug']}` v{run['runbookVersion']})",
        f"- **Runbook run ID:** `{run['id']}`",
        f"- **Run status:** `{run['status']}`",
        f"- **Current phase:** {current_phase['title']} (`{current_phase['id']}`)",
        f"- **Current task:** {current_task['title']} (`{current_task['taskKey']}`)",
        f"- **Task status:** `{current_task['status']}`",
        f"- **Capability roles:** {', '.join(current_task['capabilityRoles'])}",
        "",
        "### Skill Source Snapshot",
        "",
    ]

    if skill:
        lines.append(f"- **Skill source:** `{skill['skillMdPath']}`")
        lines.append(f"- **SKILL.md SHA-256:** `{skill['skillMdSha256']}`")
        lines.append(f"- **Contract:** `{skill['contractPath']}`")
        lines.append(f"- **Contract SHA-256:** `{skill['contractSha256']}`")
        if skill["assetRefs"]:
            lines.append(f"- **Asset references:** {_format_list(skill['assetRefs'])}")
        else:
            lines.append("- **Asset references:** None")
    else:
        lines.append("- Skill source metadata was not included in this legacy snapshot.")

    if skill and skill["skillBody"]:
        lines.extend(["", "### Skill Instructions", "", skill["skillBody"]])

    lines.extend(["", "### Capability Mapping", ""])

    for mapping in capability_mappings:
        tools = ", ".join(mapping.get("preferredTools") or [])
        suffix = f"; preferred tools: {tools}" if tools else ""
        lines.append(
            f"- `{mapping['role']}` -> `{mapping['executionTarget']}`: {mapping['guidance']}{suffix}"
        )

    phase_guidance = current_phase.get("guidanceMarkdown") or current_phase.get("guidance")
    if isinstance(phase_guidance, str) and phase_guidance.strip():
        lines.extend(["", "### Current Phase Guidance", "", phase_guidance.strip()])

    lines.extend(
        [
            "",
            "### Current Task",
            "",
            f"- Title: {current_task['title']}",
            f"- Summary: {current_task.get('summary') or 'None provided'}",
            f"- Depends on: {_format_list(current_task['dependsOn'])}",
            "",
            "### Prior Task Outputs",
            "",
        ]
    )
    if previous_outputs:
        lines.append("```json")
        lines.append(
            json.dumps(
                _compact_previous_outputs(previous_outputs),
                indent=2,
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        lines.append("```")
    else:
        lines.append("No prior task outputs are available for this task.")

    outputs = definition.get("outputs") if isinstance(definition, dict) else None
    if isinstance(outputs, list) and outputs:
        lines.extend(["", "### Expected Runbook Outputs", ""])
        for output in outputs:
            if not isinstance(output, dict):
                continue
            title = output.get("title") or output.get("id") or "Output"
            description = output.get("description") or ""
            output_type = output.get("type") or "unknown"
            lines.append(f"- **{title}** (`{output_type}`): {description}")

    lines.extend(["", "### Queue Snapshot", ""])
    for phase in build_runbook_queue_data(normalized)["phases"]:
        lines.append(f"- {phase['title']} (`{phase['id']}`)")
        for task in phase["tasks"]:
            lines.append(f"  - [{task['status']}] {task['title']} (`{task['taskKey']}`)")

    return "\n".join(lines).rstrip() + "\n"


def build_runbook_queue_part(runbook_context: Any) -> dict[str, Any]:
    normalized = _normalize_context(runbook_context)
    run_id = normalized["run"]["id"]
    return {
        "type": "data-task-queue",
        "id": f"task-queue:{run_id}",
        "data": build_task_queue_data(normalized),
    }


def build_task_queue_data(runbook_context: Any) -> dict[str, Any]:
    normalized = _normalize_context(runbook_context)
    run = normalized["run"]
    definition = normalized["definition"]
    legacy_queue = build_runbook_queue_data(normalized)
    return {
        "queueId": run["id"],
        "title": _display_name(definition, run),
        "status": run["status"],
        "source": {
            "type": "runbook",
            "id": run["id"],
            "slug": run["runbookSlug"],
        },
        "summary": "Working through the approved runbook queue.",
        "groups": [
            {
                "id": phase["id"],
                "title": phase["title"],
                "items": [
                    {
                        "id": task["id"],
                        "title": task["title"],
                        "summary": task.get("summary"),
                        "status": task["status"],
                        "metadata": {
                            "taskKey": task["taskKey"],
                            "capabilityRoles": task.get("capabilityRoles"),
                            "runbookSlug": run["runbookSlug"],
                            "runbookVersion": run["runbookVersion"],
                            "currentTaskKey": legacy_queue["currentTaskKey"],
                        },
                    }
                    for task in phase["tasks"]
                ],
            }
            for phase in legacy_queue["phases"]
        ],
    }


def build_runbook_queue_data(runbook_context: Any) -> dict[str, Any]:
    normalized = _normalize_context(runbook_context)
    run = normalized["run"]
    definition = normalized["definition"]
    display_name = _display_name(definition, run)
    tasks = normalized["tasks"]
    phases = _definition_phases(definition, tasks)

    grouped: list[dict[str, Any]] = []
    for phase in phases:
        phase_tasks = [
            _queue_task(task)
            for task in tasks
            if task.get("phaseId") == phase["id"] or task.get("phase_id") == phase["id"]
        ]
        grouped.append(
            {
                "id": phase["id"],
                "title": phase["title"],
                "tasks": phase_tasks,
            }
        )

    return {
        "runbookRunId": run["id"],
        "runbookSlug": run["runbookSlug"],
        "runbookVersion": run["runbookVersion"],
        "displayName": display_name,
        "status": run["status"],
        "currentTaskKey": normalized["currentTask"]["taskKey"],
        "phases": grouped,
    }


def _normalize_context(value: dict[str, Any]) -> dict[str, Any]:
    run = _dict_at(value, "run")
    tasks = _list_at(value, "tasks")
    definition = value.get("definitionSnapshot") or value.get("definition_snapshot") or {}
    if definition is None:
        definition = {}
    if not isinstance(definition, dict):
        raise RunbookContextError("Runbook definitionSnapshot must be an object when provided")

    normalized_run = {
        "id": _string_at(run, "id"),
        "status": _string_at(run, "status"),
        "runbookSlug": _string_at(run, "runbookSlug", fallback_key="runbook_slug"),
        "runbookVersion": _string_at(run, "runbookVersion", fallback_key="runbook_version"),
    }

    normalized_tasks = [_normalize_task(task) for task in tasks]
    current_task = value.get("currentTask") or value.get("current_task")
    if isinstance(current_task, dict):
        normalized_current = _normalize_task(current_task)
    else:
        normalized_current = _select_current_task(normalized_tasks)

    phase = _phase_for_task(definition, normalized_current)
    previous_outputs = value.get("previousOutputs")
    if previous_outputs is None:
        previous_outputs = value.get("previous_outputs")
    if previous_outputs is None:
        previous_outputs = {}
    if not isinstance(previous_outputs, dict):
        raise RunbookContextError("Runbook previousOutputs must be an object")

    return {
        "run": normalized_run,
        "tasks": normalized_tasks,
        "currentTask": normalized_current,
        "currentPhase": phase,
        "definition": definition,
        "previousOutputs": previous_outputs,
    }


def _normalize_task(task: Any) -> dict[str, Any]:
    if not isinstance(task, dict):
        raise RunbookContextError("Runbook tasks must be objects")
    task_id = _string_at(task, "id")
    task_key = _string_at(task, "taskKey", fallback_key="task_key")
    phase_id = _string_at(task, "phaseId", fallback_key="phase_id")
    capability_roles = task.get("capabilityRoles")
    if capability_roles is None:
        capability_roles = task.get("capability_roles")
    if not isinstance(capability_roles, list) or not capability_roles:
        raise RunbookContextError(f"Runbook task {task_key or task_id} has no capability roles")
    depends_on = task.get("dependsOn")
    if depends_on is None:
        depends_on = task.get("depends_on")
    if depends_on is None:
        depends_on = []
    if not isinstance(depends_on, list):
        raise RunbookContextError(f"Runbook task {task_key} dependsOn must be a list")
    return {
        "id": task_id,
        "phaseId": phase_id,
        "phaseTitle": str(task.get("phaseTitle") or task.get("phase_title") or phase_id),
        "taskKey": task_key,
        "title": str(task.get("title") or task_key),
        "summary": task.get("summary"),
        "status": str(task.get("status") or "pending"),
        "dependsOn": [str(item) for item in depends_on],
        "capabilityRoles": [str(item) for item in capability_roles],
        "sortOrder": int(task.get("sortOrder") or task.get("sort_order") or 0),
        "output": task.get("output"),
    }


def _select_current_task(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    for status in ("running", "pending"):
        for task in sorted(tasks, key=lambda item: item["sortOrder"]):
            if task["status"] == status:
                return task
    for task in sorted(tasks, key=lambda item: item["sortOrder"]):
        if task["status"] not in {"completed", "skipped", "cancelled"}:
            return task
    raise RunbookContextError("Runbook context has no executable current task")


def _phase_for_task(definition: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    phases = definition.get("phases")
    if isinstance(phases, list):
        for phase in phases:
            if isinstance(phase, dict) and phase.get("id") == task["phaseId"]:
                return {
                    "id": str(phase.get("id") or task["phaseId"]),
                    "title": str(phase.get("title") or task.get("phaseTitle") or task["phaseId"]),
                    "guidance": str(phase.get("guidance") or ""),
                    "guidanceMarkdown": str(phase.get("guidanceMarkdown") or ""),
                }
    return {
        "id": task["phaseId"],
        "title": str(task.get("phaseTitle") or task["phaseId"]),
        "guidance": "",
        "guidanceMarkdown": "",
    }


def _definition_phases(
    definition: dict[str, Any], tasks: list[dict[str, Any]]
) -> list[dict[str, str]]:
    phases = definition.get("phases")
    if isinstance(phases, list) and phases:
        return [
            {
                "id": str(phase.get("id") or ""),
                "title": str(phase.get("title") or phase.get("id") or ""),
            }
            for phase in phases
            if isinstance(phase, dict) and phase.get("id")
        ]
    seen: dict[str, str] = {}
    for task in sorted(tasks, key=lambda item: item["sortOrder"]):
        seen.setdefault(task["phaseId"], task.get("phaseTitle") or task["phaseId"])
    return [{"id": phase_id, "title": title} for phase_id, title in seen.items()]


def _assert_dependencies_available(task: dict[str, Any], previous_outputs: dict[str, Any]) -> None:
    missing = [dependency for dependency in task["dependsOn"] if dependency not in previous_outputs]
    if missing:
        raise RunbookContextError(
            f"Runbook task {task['taskKey']} is missing prior output(s): {', '.join(missing)}"
        )


def _queue_task(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "taskKey": task["taskKey"],
        "title": task["title"],
        "summary": task.get("summary"),
        "status": task["status"],
        "capabilityRoles": task["capabilityRoles"],
    }


def _skill_snapshot(definition: dict[str, Any]) -> dict[str, Any] | None:
    skill = definition.get("skill") if isinstance(definition, dict) else None
    if not isinstance(skill, dict):
        return None
    asset_refs = skill.get("assetRefs") or skill.get("asset_refs") or []
    if not isinstance(asset_refs, list):
        asset_refs = []
    return {
        "skillMdPath": str(skill.get("skillMdPath") or skill.get("skill_md_path") or "SKILL.md"),
        "skillMdSha256": str(skill.get("skillMdSha256") or skill.get("skill_md_sha256") or ""),
        "skillBody": str(skill.get("skillBody") or skill.get("skill_body") or "").strip(),
        "contractPath": str(
            skill.get("contractPath")
            or skill.get("contract_path")
            or "references/thinkwork-runbook.json"
        ),
        "contractSha256": str(skill.get("contractSha256") or skill.get("contract_sha256") or ""),
        "assetRefs": [str(ref) for ref in asset_refs if str(ref).strip()],
    }


def _display_name(definition: dict[str, Any], run: dict[str, str]) -> str:
    catalog = definition.get("catalog") if isinstance(definition, dict) else None
    if isinstance(catalog, dict) and isinstance(catalog.get("displayName"), str):
        return catalog["displayName"]
    return run["runbookSlug"]


def _dict_at(value: dict[str, Any], key: str) -> dict[str, Any]:
    result = value.get(key)
    if not isinstance(result, dict):
        raise RunbookContextError(f"Runbook context missing {key}")
    return result


def _list_at(value: dict[str, Any], key: str) -> list[Any]:
    result = value.get(key)
    if not isinstance(result, list) or not result:
        raise RunbookContextError(f"Runbook context missing {key}")
    return result


def _string_at(value: dict[str, Any], key: str, *, fallback_key: str = "") -> str:
    result = value.get(key)
    if result is None and fallback_key:
        result = value.get(fallback_key)
    if not isinstance(result, str) or not result.strip():
        raise RunbookContextError(f"Runbook context missing {key}")
    return result.strip()


def _compact_previous_outputs(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, str):
        return _truncate_text(value, MAX_PREVIOUS_OUTPUT_TEXT_CHARS)
    if isinstance(value, list):
        return [_compact_previous_outputs(item) for item in value[:8]]
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for key, nested in value.items():
            if key in {"toolInvocations", "inputText"}:
                continue
            if key in {"responseText", "outputText", "content"} and isinstance(nested, str):
                compact[key] = _truncate_text(nested, MAX_PREVIOUS_OUTPUT_TEXT_CHARS)
            else:
                compact[key] = _compact_previous_outputs(nested)
        try:
            serialized = json.dumps(compact, ensure_ascii=False, sort_keys=True)
        except TypeError:
            return str(compact)[:MAX_PREVIOUS_OUTPUT_JSON_CHARS]
        if len(serialized) <= MAX_PREVIOUS_OUTPUT_JSON_CHARS:
            return compact
        return {
            "summary": _truncate_text(serialized, MAX_PREVIOUS_OUTPUT_JSON_CHARS),
            "truncated": True,
        }
    return value


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    return value[: max(0, max_chars - 14)].rstrip() + "... [truncated]"


def _format_list(values: list[str]) -> str:
    return ", ".join(f"`{value}`" for value in values) if values else "None"
