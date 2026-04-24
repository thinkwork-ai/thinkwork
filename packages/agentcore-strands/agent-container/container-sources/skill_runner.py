"""
PRD-31 Phase 4 / PRD-38: Dynamic skill script registration.

Reads skill.yaml for skills with execution: script, imports the Python
functions from their scripts/ folder, and wraps them as Strands @tool
functions for use by the agent.

PRD-38 adds skill execution modes:
  - mode: tool (default) — scripts registered as direct tools on the parent agent
  - mode: agent — scripts reserved for a sub-agent with its own reasoning loop

Composable skills (Unit 1 of the composable-skills plan) introduces a third
execution type: `execution: composition` — a skill whose behavior is a
declarative sequence of sub-skill invocations (sequential + parallel fan-out).
Composition skills are loaded via `load_composition_skills` below; they are
intentionally NOT registered as direct agent tools because they are invoked by
the composition_runner inside a dispatched startSkillRun, not by the agent
deciding to call them from a prompt.

Usage:
    from skill_runner import register_skill_tools, register_skill_tools_grouped
    tools = register_skill_tools(skills_config, env_overrides)
    # or for PRD-38 skill-as-agent support:
    tool_tools, agent_tools, meta = register_skill_tools_grouped(skills_config)
    # or to load composition-mode skills (Unit 1):
    compositions = load_composition_skills(skills_config)
"""

import importlib.util
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

SKILLS_DIR = "/tmp/skills"


def _coerce_scalar(raw: str) -> Any:
    """Coerce a bare YAML scalar to a Python value.

    Covers the shapes the hand-rolled parser actually emits: quoted and
    unquoted strings, `true` / `false`, and integers. Anything else
    passes through as a stripped string. Matches the top-level coercion
    in _parse_skill_yaml so list-item dict values and dict-continuation
    values get the same treatment — without it, `default_enabled: true`
    in a `scripts:` list item lands as the literal string `"true"` and
    every `is True` / `== True` check silently fails.
    """
    v = raw.strip().strip('"')
    if v == "true":
        return True
    if v == "false":
        return False
    if v.lstrip("-").isdigit():
        try:
            return int(v)
        except ValueError:
            pass
    return v


def _parse_skill_yaml(filepath: str) -> dict | None:
    """Parse a simple skill.yaml file into a dict."""
    if not os.path.isfile(filepath):
        return None
    try:
        with open(filepath) as f:
            lines = f.readlines()
    except Exception:
        return None

    result: dict[str, Any] = {}
    current_key = ""
    current_list: list | None = None

    for line in lines:
        stripped = line.rstrip()
        if not stripped or stripped.startswith("#"):
            continue

        # Indented list item (e.g., "  - name: foo")
        if stripped.startswith("  - ") and current_key:
            val = stripped[4:].strip()
            if current_list is not None:
                # Check if it's a dict item (has colon)
                if ": " in val and not val.startswith('"'):
                    k, _, v = val.partition(": ")
                    # Always start a new dict for each "- key: value" entry
                    current_list.append({k.strip(): _coerce_scalar(v)})
                else:
                    current_list.append(val.strip('"'))
            continue

        # Indented dict continuation (e.g., "    path: scripts/foo.py")
        if stripped.startswith("    ") and current_list and isinstance(current_list[-1], dict):
            parts = stripped.strip().split(": ", 1)
            if len(parts) == 2:
                current_list[-1][parts[0].strip()] = _coerce_scalar(parts[1])
            continue

        # Top-level key: value
        if ":" in stripped and not stripped.startswith(" "):
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()

            if val.startswith("[") and val.endswith("]"):
                result[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
                current_key = key
                current_list = None
                continue

            if val in ("", "|"):
                result[key] = []
                current_key = key
                current_list = result[key]
                continue

            if val == "true":
                result[key] = True
            elif val == "false":
                result[key] = False
            else:
                result[key] = val.strip('"')
            current_key = key
            current_list = None

    return result


def _load_function(script_path: str, func_name: str):
    """Import a function from a Python script file."""
    if not os.path.isfile(script_path):
        raise FileNotFoundError(f"Script not found: {script_path}")

    spec = importlib.util.spec_from_file_location(f"skill_script_{func_name}", script_path)
    if not spec or not spec.loader:
        raise ImportError(f"Cannot load spec for {script_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    func = getattr(module, func_name, None)
    if not callable(func):
        raise AttributeError(f"Function '{func_name}' not found in {script_path}")

    return func


def register_skill_tools(skills_config: list[dict], env_overrides: dict[str, dict] | None = None) -> list:
    """Register script-based skill tools as Strands @tool functions.

    Args:
        skills_config: List of skill configs from the invocation payload.
            Each has: skillId, s3Key, envOverrides, etc.
        env_overrides: Per-skill environment variable overrides (skillId -> {VAR: val}).

    Returns:
        List of Strands tool objects ready to pass to Agent(tools=[...]).
    """
    import strands

    tools = []
    registered = set()

    for skill in skills_config:
        skill_id = skill.get("skillId", "")
        if not skill_id:
            continue

        skill_dir = os.path.join(SKILLS_DIR, skill_id)
        yaml_path = os.path.join(skill_dir, "skill.yaml")
        meta = _parse_skill_yaml(yaml_path)

        if not meta:
            continue
        if meta.get("execution") != "script":
            continue

        scripts = meta.get("scripts", [])
        if not scripts:
            continue

        # Inject per-skill env vars before loading scripts
        skill_env = {}
        if env_overrides and skill_id in env_overrides:
            skill_env = env_overrides[skill_id]
        # Also check envOverrides on the skill config itself (from chat-agent-invoke payload)
        payload_env = skill.get("envOverrides")
        if payload_env and isinstance(payload_env, dict):
            skill_env.update(payload_env)
        for k, v in skill_env.items():
            os.environ[k] = str(v)

        for script_def in scripts:
            if isinstance(script_def, str):
                continue  # Skip simple string entries

            func_name = script_def.get("name", "")
            script_path = script_def.get("path", "")
            description = script_def.get("description", f"Skill tool: {func_name}")

            if not func_name or not script_path:
                continue
            if func_name in registered:
                continue  # Skip duplicates (same function in multiple script defs)

            full_path = os.path.join(skill_dir, script_path)
            try:
                func = _load_function(full_path, func_name)

                # Wrap as Strands tool
                tool = strands.tool(name=func_name, description=description)(func)
                tools.append(tool)
                registered.add(func_name)
                logger.info("Registered script tool: %s from %s/%s", func_name, skill_id, script_path)
            except Exception as e:
                logger.error("Failed to register script tool %s from %s: %s", func_name, skill_id, e)

    logger.info("Script tool registration complete: %d tools from %d skills", len(tools), len(skills_config))
    return tools


def register_skill_tools_grouped(
    skills_config: list[dict],
    env_overrides: dict[str, dict] | None = None,
) -> tuple[list, dict[str, list], dict[str, dict]]:
    """Register script-based skill tools, grouped by mode (PRD-38).

    Skills with mode: agent have their tools held back from the parent agent
    and instead returned in a separate dict for sub-agent creation.

    Args:
        skills_config: List of skill configs from invocation payload.
        env_overrides: Per-skill environment variable overrides.

    Returns:
        (tool_mode_tools, agent_mode_tools_by_skill, skill_metadata) where:
        - tool_mode_tools: flat list of Strands tools for mode:tool skills (register on parent)
        - agent_mode_tools_by_skill: dict mapping skill_id -> [tool functions] for mode:agent skills
        - skill_metadata: dict mapping skill_id -> {mode, model, description, display_name, execution}
    """
    import strands

    tool_mode_tools: list = []
    agent_mode_tools: dict[str, list] = {}
    skill_metadata: dict[str, dict] = {}
    registered: set[str] = set()

    for skill in skills_config:
        skill_id = skill.get("skillId", "")
        if not skill_id:
            continue

        skill_dir = os.path.join(SKILLS_DIR, skill_id)
        yaml_path = os.path.join(skill_dir, "skill.yaml")
        meta = _parse_skill_yaml(yaml_path)

        if not meta:
            continue
        if meta.get("execution") != "script":
            continue

        scripts = meta.get("scripts", [])
        if not scripts:
            continue

        # Extract mode and model from skill.yaml (PRD-38)
        mode = meta.get("mode", "tool")  # default: tool
        model = meta.get("model", "")

        skill_metadata[skill_id] = {
            "mode": mode,
            "model": model,
            "description": meta.get("description", ""),
            "display_name": meta.get("display_name", skill_id),
            "execution": meta.get("execution", ""),
        }

        # Inject per-skill env vars before loading scripts
        skill_env = {}
        if env_overrides and skill_id in env_overrides:
            skill_env = env_overrides[skill_id]
        payload_env = skill.get("envOverrides")
        if payload_env and isinstance(payload_env, dict):
            skill_env.update(payload_env)
        for k, v in skill_env.items():
            os.environ[k] = str(v)

        skill_tools: list = []
        for script_def in scripts:
            if isinstance(script_def, str):
                continue

            func_name = script_def.get("name", "")
            script_path = script_def.get("path", "")
            description = script_def.get("description", f"Skill tool: {func_name}")

            if not func_name or not script_path:
                continue
            if func_name in registered:
                continue

            full_path = os.path.join(skill_dir, script_path)
            try:
                func = _load_function(full_path, func_name)
                tool = strands.tool(name=func_name, description=description)(func)
                skill_tools.append(tool)
                registered.add(func_name)
                logger.info("Registered script tool: %s from %s/%s (mode=%s)",
                            func_name, skill_id, script_path, mode)
            except Exception as e:
                logger.error("Failed to register script tool %s from %s: %s",
                             func_name, skill_id, e)

        if mode == "agent":
            agent_mode_tools[skill_id] = skill_tools
        else:
            tool_mode_tools.extend(skill_tools)

    total = len(tool_mode_tools) + sum(len(t) for t in agent_mode_tools.values())
    agent_count = len(agent_mode_tools)
    logger.info("Grouped skill registration: %d tool-mode tools, %d agent-mode skills (%d tools), %d total",
                len(tool_mode_tools), agent_count,
                sum(len(t) for t in agent_mode_tools.values()), total)
    return tool_mode_tools, agent_mode_tools, skill_metadata


def load_composition_skills(skills_config: list[dict]) -> dict[str, Any]:
    """Load composition-mode skills from /tmp/skills/<skill_id>/skill.yaml.

    Composition skills are not registered as agent tools — they're invoked by
    the composition_runner when startSkillRun(skillId=...) is called with a
    composition id. This loader only surfaces the validated composition schema
    so the runner can find it at dispatch time.

    Args:
        skills_config: List of skill configs from the invocation payload (same
            shape as register_skill_tools expects). Each has: skillId, s3Key, etc.

    Returns:
        Dict mapping skill_id -> CompositionSkill (pydantic model). Skills that
        aren't execution: composition are silently skipped. Invalid composition
        YAML is logged and skipped — loader never raises. CI-level validation
        happens in scripts/validate-skill-catalog.sh before deploy.
    """
    # Local import so we don't require pydantic/yaml on the script-skill path.
    try:
        from skill_inputs import load_composition
    except ImportError as exc:
        logger.error("skill_inputs module unavailable — composition skills skipped: %s", exc)
        return {}

    compositions: dict[str, Any] = {}
    for skill in skills_config:
        skill_id = skill.get("skillId", "")
        if not skill_id:
            continue
        yaml_path = os.path.join(SKILLS_DIR, skill_id, "skill.yaml")
        if not os.path.isfile(yaml_path):
            continue

        # Cheap pre-check: skip skills that aren't composition without paying
        # the full pydantic validation cost. The hand-rolled parser is fine for
        # a single top-level field lookup.
        meta = _parse_skill_yaml(yaml_path)
        if not meta or meta.get("execution") != "composition":
            continue

        try:
            comp = load_composition(yaml_path)
            compositions[comp.id] = comp
            logger.info("Loaded composition skill: %s (v%d, %d steps)",
                        comp.id, comp.version, len(comp.steps))
        except Exception as exc:
            logger.error("Failed to load composition skill %s: %s", skill_id, exc)

    logger.info("Composition skill load complete: %d compositions", len(compositions))
    return compositions
