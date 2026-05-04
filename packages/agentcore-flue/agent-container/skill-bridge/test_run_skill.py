"""Plan §005 U5 — direct pytest coverage for the skill-bridge harness.

The TS-side ToolDef tests (vitest) mock subprocess.spawn so they never
actually exercise the bridge's import + invocation logic. These tests
do, by spawning the bridge as a subprocess against synthesised skill
fixtures and asserting on the resulting stdout envelope.
"""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

BRIDGE_PATH = Path(__file__).parent / "run_skill.py"


def _run_bridge(envelope: dict | str, *, timeout: float = 10.0) -> tuple[int, str, str]:
    """Spawn the bridge with ``envelope`` on stdin and return (rc, stdout, stderr)."""
    if isinstance(envelope, dict):
        stdin = json.dumps(envelope)
    else:
        stdin = envelope
    proc = subprocess.run(
        [sys.executable, str(BRIDGE_PATH)],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _write_skill(tmp_path: Path, source: str, *, script_name: str = "main.py") -> Path:
    """Write a skill script under tmp_path/<skill>/scripts/<script_name>."""
    skill_dir = tmp_path / "demo_skill"
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True)
    script_path = scripts_dir / script_name
    script_path.write_text(textwrap.dedent(source))
    return skill_dir


def test_happy_path_returns_function_result(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def add(a, b):
            return a + b
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "add",
            "kwargs": {"a": 2, "b": 3},
        }
    )
    assert rc == 0, stdout
    payload = json.loads(stdout.strip())
    assert payload == {"ok": True, "result": 5}


def test_returns_structured_value(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def lookup(key):
            return {"key": key, "found": True, "values": [1, 2, 3]}
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "lookup",
            "kwargs": {"key": "alpha"},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is True
    assert payload["result"] == {"key": "alpha", "found": True, "values": [1, 2, 3]}


def test_function_raises_returns_structured_error(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def boom(**_):
            raise ValueError("intentional skill failure")
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "boom",
            "kwargs": {},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "intentional skill failure" in payload["error"]
    assert "ValueError" in payload["traceback"]


def test_missing_script_returns_structured_error(tmp_path):
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(tmp_path),
            "script_path": "scripts/does_not_exist.py",
            "func_name": "anything",
            "kwargs": {},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "Script not found" in payload["error"]


def test_missing_function_returns_structured_error(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def actually_present():
            return None
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "missing",
            "kwargs": {},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "missing" in payload["error"]


def test_syntax_error_in_script_returns_structured_error(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def broken(:
            pass
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "broken",
            "kwargs": {},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "SyntaxError" in payload["traceback"]


def test_non_serialisable_return_value_is_caught(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        class Custom:
            def __repr__(self):
                return "<Custom>"

        def get_obj():
            return Custom()
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "get_obj",
            "kwargs": {},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "non-JSON-serialisable" in payload["error"]


def test_malformed_json_envelope_exits_nonzero():
    rc, stdout, _ = _run_bridge("this is not json")
    assert rc != 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "Invalid envelope" in payload["error"]


def test_empty_envelope_exits_nonzero():
    rc, stdout, _ = _run_bridge("")
    assert rc != 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False


def test_envelope_missing_required_field_exits_nonzero():
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": "/tmp/x",
            # script_path missing
            "func_name": "main",
            "kwargs": {},
        }
    )
    assert rc != 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "script_path" in payload["error"]


def test_envelope_kwargs_must_be_object():
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": "/tmp/x",
            "script_path": "scripts/main.py",
            "func_name": "main",
            "kwargs": "not an object",
        }
    )
    assert rc != 0
    payload = json.loads(stdout.strip())
    assert payload["ok"] is False
    assert "kwargs" in payload["error"]


def test_kwargs_default_to_empty_object(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def no_args():
            return "ok"
        """,
    )
    rc, stdout, _ = _run_bridge(
        {
            "skill_dir": str(skill_dir),
            "script_path": "scripts/main.py",
            "func_name": "no_args",
            # kwargs intentionally omitted
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload == {"ok": True, "result": "ok"}


def test_absolute_script_path_is_honoured(tmp_path):
    skill_dir = _write_skill(
        tmp_path,
        """
        def echo(msg):
            return msg
        """,
    )
    abs_script = skill_dir / "scripts" / "main.py"
    assert abs_script.is_absolute()
    rc, stdout, _ = _run_bridge(
        {
            # skill_dir is irrelevant when script_path is absolute, but
            # we still pass it for envelope completeness.
            "skill_dir": str(skill_dir),
            "script_path": str(abs_script),
            "func_name": "echo",
            "kwargs": {"msg": "hello"},
        }
    )
    assert rc == 0
    payload = json.loads(stdout.strip())
    assert payload == {"ok": True, "result": "hello"}
