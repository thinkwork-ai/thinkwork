from __future__ import annotations

"""Parse workspace CONTEXT.md files into WorkspaceConfig for sub-agent spawning.

Each workspace folder (e.g., personal-assistant/, research/) contains a CONTEXT.md
that defines the sub-agent's role, model, skills, loading rules, and guardrails.
The runtime discovers these folders, parses their CONTEXT.md, and spawns a Strands
sub-agent for each workspace.

Expected CONTEXT.md format:

    # Workspace Name

    ## What This Workspace Is
    One-line description of the workspace purpose.

    ## Config
    - model: us.anthropic.claude-haiku-4-5

    ## What to Load
    | Task | Load These | Skip These |
    |------|-----------|------------|
    | Task A | docs/a.md | docs/b.md |

    ## Skills & Tools
    | Skill | When | Model Override | Purpose |
    |-------|------|---------------|---------|
    | Google Calendar | Scheduling | — | Create events |

    ## Process
    1. Step one
    2. Step two

    ## What NOT to Do
    - Don't do X
    - Don't do Y
"""
import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class SkillEntry:
    """A skill declared in a workspace CONTEXT.md."""
    name: str
    when: str = ""
    model_override: str = ""
    purpose: str = ""


@dataclass
class LoadRule:
    """A task-specific loading rule from the 'What to Load' table."""
    task: str
    load: list[str] = field(default_factory=list)
    skip: list[str] = field(default_factory=list)


@dataclass
class WorkspaceConfig:
    """Parsed workspace configuration from CONTEXT.md."""
    name: str
    slug: str  # Derived from folder name
    folder: str  # Absolute path to workspace folder
    role: str = ""
    model: str = ""
    skills: list[SkillEntry] = field(default_factory=list)
    load_rules: list[LoadRule] = field(default_factory=list)
    process: str = ""
    guardrails: str = ""
    raw_content: str = ""  # Full CONTEXT.md content for sub-agent prompt


def _parse_table(lines: list[str]) -> list[list[str]]:
    """Parse a markdown table into a list of row cells (skipping header + separator)."""
    rows = []
    header_seen = False
    separator_seen = False
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            if header_seen:
                break
            continue
        cells = [c.strip() for c in stripped.split("|")[1:-1]]
        if not header_seen:
            header_seen = True
            continue
        if not separator_seen:
            # Skip the |---|---| separator
            if all(re.match(r"^[-:]+$", c) for c in cells):
                separator_seen = True
                continue
        if cells:
            rows.append(cells)
    return rows


def _extract_section(content: str, heading: str) -> str:
    """Extract content between a ## heading and the next ## heading."""
    pattern = rf"^##\s+{re.escape(heading)}\s*$"
    lines = content.split("\n")
    start = None
    for i, line in enumerate(lines):
        if re.match(pattern, line.strip(), re.IGNORECASE):
            start = i + 1
            break
    if start is None:
        return ""

    end = len(lines)
    for i in range(start, len(lines)):
        if re.match(r"^##\s+", lines[i].strip()) and i != start - 1:
            end = i
            break

    return "\n".join(lines[start:end]).strip()


def parse_context_md(filepath: str, slug: str = "") -> WorkspaceConfig | None:
    """Parse a workspace CONTEXT.md file into a WorkspaceConfig.

    Args:
        filepath: Absolute path to the CONTEXT.md file.
        slug: Workspace slug (folder name). Derived from filepath if not provided.

    Returns:
        WorkspaceConfig or None if the file can't be parsed.
    """
    if not os.path.isfile(filepath):
        return None

    try:
        with open(filepath) as f:
            content = f.read()
    except Exception as e:
        logger.warning("Failed to read %s: %s", filepath, e)
        return None

    if not content.strip():
        return None

    folder = os.path.dirname(filepath)
    if not slug:
        slug = os.path.basename(folder)

    # Extract name from H1
    name_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    name = name_match.group(1).strip() if name_match else slug

    # Extract role from "What This Workspace Is"
    role = _extract_section(content, "What This Workspace Is")

    # Extract model from "Config"
    config_section = _extract_section(content, "Config")
    model = ""
    if config_section:
        model_match = re.search(r"model:\s*(.+)", config_section)
        if model_match:
            model = model_match.group(1).strip()

    # Extract skills from "Skills & Tools" table
    skills = []
    skills_section = _extract_section(content, "Skills & Tools")
    if skills_section:
        rows = _parse_table(skills_section.split("\n"))
        for row in rows:
            if len(row) >= 1:
                skill_name = row[0].strip()
                when = row[1].strip() if len(row) > 1 else ""
                model_override = row[2].strip() if len(row) > 2 else ""
                purpose = row[3].strip() if len(row) > 3 else ""
                # Normalize "—" and "-" to empty
                if model_override in ("—", "-", "–"):
                    model_override = ""
                skills.append(SkillEntry(
                    name=skill_name,
                    when=when,
                    model_override=model_override,
                    purpose=purpose,
                ))

    # Extract load rules from "What to Load" table
    load_rules = []
    load_section = _extract_section(content, "What to Load")
    if load_section:
        rows = _parse_table(load_section.split("\n"))
        for row in rows:
            if len(row) >= 2:
                task = row[0].strip()
                load_files = [f.strip() for f in row[1].split(",") if f.strip()]
                skip_files = [f.strip() for f in row[2].split(",") if f.strip()] if len(row) > 2 else []
                load_rules.append(LoadRule(task=task, load=load_files, skip=skip_files))

    # Extract process
    process = _extract_section(content, "Process")

    # Extract guardrails from "What NOT to Do"
    guardrails = _extract_section(content, "What NOT to Do")

    config = WorkspaceConfig(
        name=name,
        slug=slug,
        folder=folder,
        role=role,
        model=model,
        skills=skills,
        load_rules=load_rules,
        process=process,
        guardrails=guardrails,
        raw_content=content,
    )
    logger.info("Parsed workspace %s: model=%s, skills=%d, load_rules=%d",
                slug, model or "(inherit)", len(skills), len(load_rules))
    return config


def discover_workspaces(workspace_dir: str) -> list[WorkspaceConfig]:
    """Scan a workspace directory for sub-workspace folders with CONTEXT.md.

    Returns a list of WorkspaceConfig for each discovered workspace.
    Only scans one level deep (immediate subdirectories).
    """
    configs = []
    if not os.path.isdir(workspace_dir):
        return configs

    for entry in sorted(os.listdir(workspace_dir)):
        subdir = os.path.join(workspace_dir, entry)
        if not os.path.isdir(subdir):
            continue
        # Skip hidden dirs and special dirs
        if entry.startswith(".") or entry.startswith("_"):
            continue
        context_path = os.path.join(subdir, "CONTEXT.md")
        if os.path.isfile(context_path):
            config = parse_context_md(context_path, slug=entry)
            if config:
                configs.append(config)

    logger.info("Discovered %d workspace(s) in %s: %s",
                len(configs), workspace_dir, [c.slug for c in configs])
    return configs
