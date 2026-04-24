"""Pytest config — put container-sources/ on sys.path for every test module.

Before U2, each test file started with its own `sys.path.insert(0, os.path.dirname(__file__))`.
That worked because the agent-container modules and the tests lived in the same
directory. After the move, the modules now live under `container-sources/` (so the
Dockerfile wildcard-COPY can pick them up without a hand-maintained list) while
the tests stay at this directory. Pytest runs conftest.py discovery at the test
root, so centralising the sys.path insert here lets every test `import server`,
`import skill_runner`, etc. without repeating the boilerplate.
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_CONTAINER_SOURCES = os.path.join(_HERE, "container-sources")

if _CONTAINER_SOURCES not in sys.path:
    sys.path.insert(0, _CONTAINER_SOURCES)
