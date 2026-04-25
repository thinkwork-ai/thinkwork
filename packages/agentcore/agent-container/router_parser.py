from __future__ import annotations

"""Parse ROUTER.md into context profiles for selective workspace loading.

ROUTER.md defines named context profiles that control which workspace files
load for a given invocation. The default profile provides base files that
always load. Named profiles add files on top (additive inheritance) and can
optionally skip specific default files.

Resolution order:
1. context_profile from ticket metadata (process step)
2. trigger channel (chat, email, heartbeat, scheduled)
3. "default" profile
4. None → load all files (backward compatible)
"""
import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ContextProfile:
    """Resolved context profile with merged file paths."""
    load: list[str] = field(default_factory=list)


@dataclass
class RawProfile:
    """A single profile parsed from ROUTER.md before inheritance merge."""
    name: str
    load: list[str] = field(default_factory=list)
    skip: list[str] = field(default_factory=list)


def parse_router(router_path: str) -> dict[str, RawProfile]:
    """Parse ROUTER.md into a dict of profile name → RawProfile."""
    if not os.path.isfile(router_path):
        return {}

    try:
        with open(router_path) as f:
            content = f.read()
    except Exception as e:
        logger.warning("Failed to read ROUTER.md: %s", e)
        return {}

    profiles: dict[str, RawProfile] = {}
    current_name: str | None = None
    current_profile: RawProfile | None = None

    for line in content.split("\n"):
        # H2 header = new profile
        header_match = re.match(r"^## (.+)$", line.strip())
        if header_match:
            if current_name and current_profile:
                profiles[current_name] = current_profile
            current_name = header_match.group(1).strip()
            current_profile = RawProfile(name=current_name)
            continue

        if current_profile is None:
            continue

        # Parse directives: - load: ..., - skip: ...
        # Skills now live in AGENTS.md routing rows. Legacy "- skills:"
        # directives intentionally parse as prose so they cannot narrow the
        # runtime skill set behind the agent builder's back.
        directive_match = re.match(r"^- (load|skip):\s*(.+)$", line.strip())
        if directive_match:
            key = directive_match.group(1)
            values = [v.strip() for v in directive_match.group(2).split(",") if v.strip()]
            if key == "load":
                current_profile.load.extend(values)
            elif key == "skip":
                current_profile.skip.extend(values)

    # Don't forget the last profile
    if current_name and current_profile:
        profiles[current_name] = current_profile

    logger.info("Parsed ROUTER.md: %d profiles (%s)", len(profiles), ", ".join(profiles.keys()))
    return profiles


def resolve_profile(router_path: str, channel: str = "",
                    context_profile: str | None = None) -> ContextProfile | None:
    """Parse ROUTER.md and resolve the active context profile.

    Resolution order:
    1. context_profile (from ticket metadata / process step)
    2. channel (trigger channel: chat, email, heartbeat, scheduled)
    3. "default" only
    4. None (no ROUTER.md → load everything)

    Returns a merged ContextProfile with additive inheritance from default,
    or None if no ROUTER.md exists (signals fallback to load-all behavior).
    """
    profiles = parse_router(router_path)
    if not profiles:
        return None

    default = profiles.get("default")
    if not default:
        logger.warning("ROUTER.md has no default profile, falling back to load-all")
        return None

    # Find the matching named profile
    matched: RawProfile | None = None
    match_source = "default"

    # 1. Try exact context_profile match (e.g. "process:customer-onboarding:step-1")
    if context_profile and context_profile in profiles:
        matched = profiles[context_profile]
        match_source = f"context_profile:{context_profile}"

    # 2. Try channel match
    elif channel and channel in profiles:
        matched = profiles[channel]
        match_source = f"channel:{channel}"

    # 3. Default only
    # (matched stays None, we just use default)

    # Build merged profile: default base + matched additions - skips
    base_files = list(default.load)

    if matched:
        # Apply skip: remove specified files from base
        if matched.skip:
            base_files = [f for f in base_files if f not in matched.skip]

        # Merge: base + profile additions, deduplicated preserving order
        all_files = base_files + [f for f in matched.load if f not in base_files]

    else:
        all_files = base_files

    resolved = ContextProfile(load=all_files)
    logger.info("Resolved profile [%s]: %d files", match_source, len(resolved.load))
    return resolved


def expand_file_list(workspace_dir: str, file_patterns: list[str]) -> list[str]:
    """Expand file patterns into actual file paths.

    - Paths ending in / are expanded to all files in that directory recursively.
    - Other paths are returned as-is (if the file exists).

    Returns list of relative paths that exist on disk.
    """
    result: list[str] = []
    seen: set[str] = set()

    for pattern in file_patterns:
        if pattern.endswith("/"):
            # Directory: load all files recursively
            dir_path = os.path.join(workspace_dir, pattern.rstrip("/"))
            if os.path.isdir(dir_path):
                for root, _dirs, files in os.walk(dir_path):
                    for fname in sorted(files):
                        full = os.path.join(root, fname)
                        rel = os.path.relpath(full, workspace_dir)
                        if rel not in seen:
                            seen.add(rel)
                            result.append(rel)
        else:
            # Single file
            full_path = os.path.join(workspace_dir, pattern)
            if os.path.isfile(full_path) and pattern not in seen:
                seen.add(pattern)
                result.append(pattern)

    return result
