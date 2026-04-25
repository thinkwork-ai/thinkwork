"""Workspace target validation shared by folder-addressed tools."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

TARGET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}(/[a-z0-9][a-z0-9-]{0,63})*$")
RESERVED_SEGMENTS = {"memory", "skills"}
WORKSPACE_TARGET_DEPTH_CAP = 4


@dataclass(frozen=True)
class WorkspaceTargetResult:
    valid: bool
    normalized_path: str | None
    depth: int
    reason: str | None


def _normalize_route(route: str) -> str | None:
    trimmed = route.strip().rstrip("/")
    if not trimmed or trimmed == ".":
        return ""
    if not TARGET_RE.match(trimmed):
        return None
    if any(segment in RESERVED_SEGMENTS for segment in trimmed.split("/")):
        return None
    return trimmed


def parse_target(input: str, agents_md_routes: Iterable[str]) -> WorkspaceTargetResult:
    if input is None:
        return WorkspaceTargetResult(False, None, 0, "empty")

    trimmed = input.strip()
    if not trimmed:
        return WorkspaceTargetResult(False, None, 0, "empty")
    if trimmed == ".":
        return WorkspaceTargetResult(True, "", 0, None)
    if trimmed.startswith("/"):
        return WorkspaceTargetResult(False, None, 0, "absolute")
    if "\\" in trimmed or "?" in trimmed or "#" in trimmed:
        return WorkspaceTargetResult(False, None, 0, "malformed")
    if ".." in trimmed:
        return WorkspaceTargetResult(False, None, 0, "traversal")
    if not TARGET_RE.match(trimmed):
        return WorkspaceTargetResult(False, None, 0, "malformed")

    segments = trimmed.split("/")
    depth = len(segments)
    if any(segment in RESERVED_SEGMENTS for segment in segments):
        return WorkspaceTargetResult(False, None, depth, "reserved_name")
    if depth > WORKSPACE_TARGET_DEPTH_CAP:
        return WorkspaceTargetResult(False, None, depth, "depth_exceeded")

    routable = {
        normalized
        for route in agents_md_routes
        if (normalized := _normalize_route(route)) is not None
    }
    if trimmed not in routable:
        return WorkspaceTargetResult(False, None, depth, "not_routable")

    return WorkspaceTargetResult(True, trimmed, depth, None)

