"""PRD-38: Dynamic skill script registration for the parent chat agent.

Reads SKILL.md frontmatter for skills with execution: script, imports
the Python functions from their scripts/ folder, and wraps them as
Strands @tool functions. Two modes:

  - mode: tool (default) — scripts registered as direct tools on the parent
    agent
  - mode: agent — scripts held back for a sub-agent with its own reasoning
    loop

Plan 2026-04-24-009 §U3 — the canonical metadata source flipped from
``skill.yaml`` to SKILL.md frontmatter; the hand-rolled
``_parse_skill_yaml`` helper that lived here was retired in favour of
:mod:`skill_md_parser`. U6 (PR #547) had already removed the parallel
orchestrator modules plus ``load_composition_skills``; every skill
whose behavior used to be a declarative sequence of sub-skill
invocations is a context skill that runs inside the chat loop via the
``Skill`` meta-tool — so the loader below only needs one code path.

Usage:
    from skill_runner import register_skill_tools
    tool_tools, agent_tools, meta = register_skill_tools(skills_config)
"""

import importlib.util
import logging
import os

from skill_md_parser import SkillMdParseError, parse_skill_md_file

logger = logging.getLogger(__name__)

WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "/tmp/workspace")


def discover_workspace_skill_dirs(workspace_dir: str | None = None) -> dict[str, str]:
    """Return skill slug -> local skill directory from the materialized workspace.

    Activation is filesystem-truth: any ``**/skills/<slug>/SKILL.md`` copied
    into the AgentCore workspace before the turn is available to the runtime.
    """
    root = workspace_dir or WORKSPACE_DIR
    found: dict[str, str] = {}
    if not os.path.isdir(root):
        return found

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        if "SKILL.md" not in filenames:
            continue
        parent = os.path.basename(os.path.dirname(dirpath))
        if parent != "skills":
            continue
        slug = os.path.basename(dirpath)
        if slug and slug not in found:
            found[slug] = dirpath
    return found


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


def register_skill_tools(
    skills_config: list[dict],
    env_overrides: dict[str, dict] | None = None,
    workspace_dir: str | None = None,
) -> tuple[list, dict[str, list], dict[str, dict]]:
    """Register script-based skill tools, grouped by mode (PRD-38).

    Skills with mode: agent have their tools held back from the parent agent
    and instead returned in a separate dict for sub-agent creation.

    Args:
        skills_config: List of skill configs from invocation payload.
        env_overrides: Per-skill environment variable overrides.
        workspace_dir: Local materialized workspace root.

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
    config_by_id = {
        skill.get("skillId", ""): skill
        for skill in skills_config
        if isinstance(skill, dict) and skill.get("skillId", "")
    }
    skill_dirs = discover_workspace_skill_dirs(workspace_dir)

    for skill_id, skill_dir in skill_dirs.items():
        skill_md_path = os.path.join(skill_dir, "SKILL.md")
        try:
            parsed = parse_skill_md_file(skill_md_path)
        except SkillMdParseError as exc:
            logger.warning(
                "Skipping %s: SKILL.md frontmatter parse failed: %s",
                skill_id, exc,
            )
            continue

        if parsed is None:
            continue
        meta = parsed.data

        skill_metadata[skill_id] = {
            "mode": meta.get("mode", "tool"),
            "model": meta.get("model", ""),
            "description": meta.get("description", ""),
            "display_name": meta.get("display_name", skill_id),
            "execution": meta.get("execution", "context"),
            "skill_dir": skill_dir,
            "skill_md_path": skill_md_path,
        }

        if meta.get("execution") != "script":
            continue
        scripts = meta.get("scripts", [])
        if not scripts:
            continue

        # Extract mode and model from frontmatter (PRD-38)
        mode = meta.get("mode", "tool")  # default: tool

        # Inject per-skill env vars before loading scripts
        skill_env = {}
        if env_overrides and skill_id in env_overrides:
            skill_env = env_overrides[skill_id]
        skill = config_by_id.get(skill_id, {})
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
