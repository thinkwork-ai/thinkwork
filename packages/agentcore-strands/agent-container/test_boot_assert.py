"""Tests for container-sources/_boot_assert.py — the filesystem check that
guards against Dockerfile COPY drift dropping a runtime module.

Run with:
    uv run --no-project --with pytest \
        pytest packages/agentcore-strands/agent-container/test_boot_assert.py
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

import _boot_assert as ba  # conftest.py puts container-sources/ on sys.path


def _seed(app_dir: str, modules: tuple[str, ...], shared: tuple[str, ...], auth_agent: tuple[str, ...]) -> None:
    """Create empty placeholder files that mimic the modules a real /app would hold."""
    for mod in modules + shared:
        with open(os.path.join(app_dir, f"{mod}.py"), "w", encoding="utf-8") as f:
            f.write("# placeholder\n")
    if auth_agent:
        os.makedirs(os.path.join(app_dir, "auth-agent"), exist_ok=True)
        for rel in auth_agent:
            # rel is like "auth-agent/__init__.py"
            full = os.path.join(app_dir, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write("# placeholder\n")


def _entrypoint_available():
    return patch.object(
        ba.shutil,
        "which",
        return_value="/usr/local/bin/opentelemetry-instrument",
    )


class BootAssertTests(unittest.TestCase):
    def test_passes_when_every_expected_module_is_present(self):
        with tempfile.TemporaryDirectory() as app_dir:
            _seed(
                app_dir,
                ba.EXPECTED_CONTAINER_SOURCES,
                ba.EXPECTED_SHARED,
                ba.EXPECTED_AUTH_AGENT,
            )
            # Should not raise.
            with _entrypoint_available():
                ba.check(app_dir)

    def test_raises_with_missing_module_name_when_container_source_is_dropped(self):
        with tempfile.TemporaryDirectory() as app_dir:
            _seed(
                app_dir,
                ba.EXPECTED_CONTAINER_SOURCES,
                ba.EXPECTED_SHARED,
                ba.EXPECTED_AUTH_AGENT,
            )
            # Simulate "new module foo.py silently dropped by Dockerfile COPY drift"
            # by removing one of the expected files.
            dropped = ba.EXPECTED_CONTAINER_SOURCES[0]
            os.remove(os.path.join(app_dir, f"{dropped}.py"))

            with _entrypoint_available():
                with self.assertRaises(RuntimeError) as cm:
                    ba.check(app_dir)
            # The whole point of the assertion is that it names the missing file
            # so `docker build` output tells you exactly what to fix.
            self.assertIn(f"{dropped}.py", str(cm.exception))

    def test_raises_when_shared_module_is_missing(self):
        with tempfile.TemporaryDirectory() as app_dir:
            _seed(
                app_dir,
                ba.EXPECTED_CONTAINER_SOURCES,
                ba.EXPECTED_SHARED,
                ba.EXPECTED_AUTH_AGENT,
            )
            dropped = ba.EXPECTED_SHARED[0]
            os.remove(os.path.join(app_dir, f"{dropped}.py"))

            with _entrypoint_available():
                with self.assertRaises(RuntimeError) as cm:
                    ba.check(app_dir)
            self.assertIn(f"{dropped}.py", str(cm.exception))

    def test_raises_when_auth_agent_init_is_missing(self):
        with tempfile.TemporaryDirectory() as app_dir:
            _seed(
                app_dir,
                ba.EXPECTED_CONTAINER_SOURCES,
                ba.EXPECTED_SHARED,
                ba.EXPECTED_AUTH_AGENT,
            )
            # auth-agent lives under its own directory, exercise that code path.
            os.remove(os.path.join(app_dir, "auth-agent", "__init__.py"))

            with _entrypoint_available():
                with self.assertRaises(RuntimeError) as cm:
                    ba.check(app_dir)
            self.assertIn("auth-agent/__init__.py", str(cm.exception))

    def test_raises_when_required_entrypoint_executable_is_missing(self):
        with tempfile.TemporaryDirectory() as app_dir:
            _seed(
                app_dir,
                ba.EXPECTED_CONTAINER_SOURCES,
                ba.EXPECTED_SHARED,
                ba.EXPECTED_AUTH_AGENT,
            )

            with patch.object(ba.shutil, "which", return_value=None):
                with self.assertRaises(RuntimeError) as cm:
                    ba.check(app_dir)
            self.assertIn("opentelemetry-instrument", str(cm.exception))

    def test_expected_container_sources_covers_every_sibling_module_file(self):
        """Integration guard: EXPECTED_CONTAINER_SOURCES must list every .py
        file in the container-sources/ directory. If someone adds a new module
        there without updating the tuple, this test fails — we find out at test
        time instead of when a production boot mysteriously fails.
        """
        here = os.path.dirname(os.path.abspath(ba.__file__))
        on_disk = {
            fn[:-3]
            for fn in os.listdir(here)
            if fn.endswith(".py") and not fn.startswith("_") and not fn.startswith("test_")
        }
        declared = set(ba.EXPECTED_CONTAINER_SOURCES)
        missing_from_list = on_disk - declared
        extra_in_list = declared - on_disk
        self.assertEqual(
            missing_from_list,
            set(),
            f"Modules present in container-sources/ but missing from "
            f"EXPECTED_CONTAINER_SOURCES: {sorted(missing_from_list)}",
        )
        self.assertEqual(
            extra_in_list,
            set(),
            f"Modules listed in EXPECTED_CONTAINER_SOURCES but absent from "
            f"container-sources/: {sorted(extra_in_list)}",
        )

    def test_expected_shared_covers_every_module_in_agentcore_container(self):
        """Integration guard mirroring the container-sources check, but for
        the shared agentcore modules that the Dockerfile now wildcard-COPYs
        from packages/agentcore/agent-container/ (plan §008 U1). Adding a new
        runtime module there without registering it in EXPECTED_SHARED would
        ship the file but skip the boot-time presence check — exactly the
        drift class this assertion is meant to catch.

        `hindsight_client.py` is renamed to `hs_urllib_client.py` at COPY
        time; the on-disk set is translated through that rename so the
        comparison stays apples-to-apples with the runtime name.
        """
        # Walk from container-sources/ up to packages/agentcore/agent-container/
        # (sibling-of-sibling). Anchor on _boot_assert.__file__ so the path stays
        # honest if the test layout moves later.
        container_sources = os.path.dirname(os.path.abspath(ba.__file__))
        agent_container = os.path.dirname(container_sources)
        agentcore_strands = os.path.dirname(agent_container)
        packages = os.path.dirname(agentcore_strands)
        shared_dir = os.path.join(packages, "agentcore", "agent-container")

        on_disk = {
            fn[:-3]
            for fn in os.listdir(shared_dir)
            if fn.endswith(".py") and not fn.startswith("_") and not fn.startswith("test_")
        }
        # Translate the COPY-time rename so the comparison matches the runtime
        # name the boot-assert checks for.
        if "hindsight_client" in on_disk:
            on_disk.remove("hindsight_client")
            on_disk.add("hs_urllib_client")

        declared = set(ba.EXPECTED_SHARED)
        missing_from_list = on_disk - declared
        extra_in_list = declared - on_disk
        self.assertEqual(
            missing_from_list,
            set(),
            f"Modules present in packages/agentcore/agent-container/ but "
            f"missing from EXPECTED_SHARED: {sorted(missing_from_list)}. "
            f"Add them to _boot_assert.EXPECTED_SHARED so the boot-time "
            f"check covers them.",
        )
        self.assertEqual(
            extra_in_list,
            set(),
            f"Modules listed in EXPECTED_SHARED but absent from "
            f"packages/agentcore/agent-container/: {sorted(extra_in_list)}",
        )


if __name__ == "__main__":
    unittest.main()
