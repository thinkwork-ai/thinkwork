"""Pytest config — mirror the container's /app sys.path for every test module.

Before U2, each test file started with its own `sys.path.insert(0, os.path.dirname(__file__))`.
That worked because the agent-container modules and the tests lived in the same
directory. After the move, the modules now live under `container-sources/` (so the
Dockerfile wildcard-COPY can pick them up without a hand-maintained list) while
the tests stay at this directory. Pytest runs conftest.py discovery at the test
root, so centralising the sys.path insert here lets every test `import server`,
`import skill_runner`, etc. without repeating the boilerplate.

The runtime container's `/app` flattens both `container-sources/*.py` and the
shared `packages/agentcore/agent-container/*.py` modules side-by-side (see
``_boot_assert.EXPECTED_CONTAINER_SOURCES`` and ``EXPECTED_SHARED``). Tests have
to mirror that layout so a Strands-side module that imports a shared module
(e.g. ``delegate_to_workspace_tool`` importing ``agents_md_parser``) resolves
the same way under pytest as it does in the container.
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_CONTAINER_SOURCES = os.path.join(_HERE, "container-sources")
_SHARED_AGENTCORE = os.path.abspath(
    os.path.join(_HERE, "..", "..", "agentcore", "agent-container")
)

for path in (_CONTAINER_SOURCES, _SHARED_AGENTCORE):
    if path not in sys.path:
        sys.path.insert(0, path)
