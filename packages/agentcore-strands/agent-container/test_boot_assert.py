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

            with self.assertRaises(RuntimeError) as cm:
                ba.check(app_dir)
            self.assertIn("auth-agent/__init__.py", str(cm.exception))

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


if __name__ == "__main__":
    unittest.main()
