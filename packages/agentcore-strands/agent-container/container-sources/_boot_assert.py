"""Defense-in-depth check that every module the runtime needs landed in /app.

History: Dockerfile explicit-COPY drift has shipped "module missing at runtime"
four times in seven days (see docs/solutions/build-errors/
dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md). The primary
fix for that is the wildcard `COPY container-sources/ /app/` line in the
Dockerfile. This assertion is the belt to that suspenders: if a rename, a .dockerignore
rule, or a packaging regression ever silently drops a file, the failure shows up
at `docker build` (or at server startup if something slipped past build), not on
the first production turn that needs the tool.

Why a static list rather than "import every sibling .py file":
- The container's Python environment is only complete after all imports succeed
  in dependency order. Importing modules blindly at boot (before their own
  top-of-module env reads finish) would couple boot-assert to import ordering.
- File-presence is the invariant we actually care about. The bug class we're
  hardening against is "the COPY list didn't include foo.py" — a filesystem
  question, not an import-graph question. If a file is present but broken, the
  first real import will surface it loudly (same as today).

Keep EXPECTED_* lists in sync with the Dockerfile COPY block and the shared
module set from packages/agentcore/agent-container/.
"""

from __future__ import annotations

import os
import sys

# container-sources/ modules — these travel into /app via the wildcard COPY.
EXPECTED_CONTAINER_SOURCES: tuple[str, ...] = (
    "api_memory_client",
    "composition_runner",
    "eval_span_attrs",
    "external_task_context",
    "hindsight_recall_filter",
    "hindsight_usage_capture",
    "invocation_env",
    "memory_tools",
    "run_skill_dispatch",
    "sandbox_preamble",
    "sandbox_tool",
    "server",
    "shadow_dispatch",
    "skill_dispatcher",
    "skill_inputs",
    "skill_meta_tool",
    "skill_runner",
    "skill_session_pool",
    "update_agent_name_tool",
    "update_identity_tool",
    "update_user_profile_tool",
    "wiki_tools",
    "workflow_skill_context",
    "workspace_composer_client",
    "write_memory_tool",
)

# Shared modules — these are COPYd explicitly from packages/agentcore/agent-container/
# into /app. They change rarely and have a separate review workflow, so we keep
# their COPY lines explicit rather than folding them into container-sources/.
# `hindsight_client.py` is renamed to `hs_urllib_client.py` at COPY time.
EXPECTED_SHARED: tuple[str, ...] = (
    "bedrock_request_tracker",
    "context_parser",
    "hs_urllib_client",
    "identity",
    "install_skills",
    "kb_search_server",
    "memory",
    "observability",
    "permissions",
    "router_parser",
    "safety",
)

# Auth-agent package lives under /app/auth-agent/ (own directory, not flat).
EXPECTED_AUTH_AGENT: tuple[str, ...] = (
    "auth-agent/__init__.py",
    "auth-agent/permission_request.py",
)


def _missing(app_dir: str) -> list[str]:
    out: list[str] = []
    for mod in EXPECTED_CONTAINER_SOURCES + EXPECTED_SHARED:
        if not os.path.isfile(os.path.join(app_dir, f"{mod}.py")):
            out.append(f"{mod}.py")
    for rel in EXPECTED_AUTH_AGENT:
        if not os.path.isfile(os.path.join(app_dir, rel)):
            out.append(rel)
    return out


def check(app_dir: str = "/app") -> None:
    """Raise RuntimeError if any expected module file is missing under app_dir.

    Called from two places:
      1. Dockerfile build step — catches drift at image build, not production boot.
      2. server.py startup — catches filesystem regressions that slipped past build
         (e.g. someone baked a debug image and rm'd a file).
    """
    missing = _missing(app_dir)
    if missing:
        raise RuntimeError(
            f"[_boot_assert] missing {len(missing)} expected module(s) under {app_dir}:\n  "
            + "\n  ".join(missing)
            + "\nSee _boot_assert.py for the expected module list."
        )
    total = len(EXPECTED_CONTAINER_SOURCES) + len(EXPECTED_SHARED) + len(EXPECTED_AUTH_AGENT)
    print(
        f"[_boot_assert] ok — {total} expected files present under {app_dir} "
        f"({len(EXPECTED_CONTAINER_SOURCES)} container-sources, "
        f"{len(EXPECTED_SHARED)} shared, {len(EXPECTED_AUTH_AGENT)} auth-agent)",
        flush=True,
    )


if __name__ == "__main__":
    # Support `python _boot_assert.py [/app]` from the Dockerfile.
    app_dir = sys.argv[1] if len(sys.argv) > 1 else "/app"
    check(app_dir)
