"""Plan §005 U5 — Python skill-bridge for the Flue (Node) runtime.

The Flue agent loop runs in Node. Python script-skills from
`packages/skill-catalog/` are not in-process imports here (the way they
are in the Strands runtime); they execute via subprocess instead. This
script is the bridge — Node spawns it, sends a JSON envelope on stdin,
the bridge imports the named script + calls the named function with
**kwargs, and emits a result envelope on stdout.

Envelope contract (stdin):

    {
      "skill_dir": "/abs/path/to/skill",
      "script_path": "scripts/dispatch.py",
      "func_name": "start_skill_run",
      "kwargs": { ... }
    }

Result envelope (stdout — exactly one JSON object, then a trailing
newline). On success:

    { "ok": true, "result": <return value of the function> }

On failure:

    { "ok": false, "error": "<message>", "traceback": "<formatted>" }

The bridge always exits 0 when it can produce a structured envelope.
A non-zero exit code only indicates an unrecoverable bridge failure
(e.g. malformed stdin) — the Node side treats that as a tool error.

Stdlib only. Per-skill Python deps are inherited from the container's
runtime environment; the bridge does not install or resolve them.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from typing import Any


def _emit(envelope: dict[str, Any]) -> None:
    """Write a single JSON object + newline to stdout and flush."""
    sys.stdout.write(json.dumps(envelope))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _load_function(script_path: str, func_name: str):
    """Import the named function from a .py file at ``script_path``.

    Mirrors ``packages/agentcore-strands/agent-container/container-sources/
    skill_runner.py:_load_function`` so script-skills behave the same
    whether the Strands runtime imports them in-process or the Flue
    runtime subprocess-bridges them.
    """
    spec = importlib.util.spec_from_file_location(
        f"thinkwork_skill_bridge_{func_name}", script_path
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot create import spec for {script_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    func = getattr(module, func_name, None)
    if not callable(func):
        raise AttributeError(
            f"Function '{func_name}' not found in {script_path}"
        )
    return func


def _read_envelope() -> dict[str, Any]:
    """Read and parse the JSON envelope from stdin."""
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Empty stdin envelope")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Envelope must be a JSON object")
    return parsed


def _validate_envelope(envelope: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    """Validate envelope shape and return (skill_dir, script_path, func_name, kwargs)."""
    skill_dir = envelope.get("skill_dir")
    script_path = envelope.get("script_path")
    func_name = envelope.get("func_name")
    kwargs = envelope.get("kwargs", {})

    if not isinstance(skill_dir, str) or not skill_dir:
        raise ValueError("Envelope field 'skill_dir' must be a non-empty string")
    if not isinstance(script_path, str) or not script_path:
        raise ValueError("Envelope field 'script_path' must be a non-empty string")
    if not isinstance(func_name, str) or not func_name:
        raise ValueError("Envelope field 'func_name' must be a non-empty string")
    if not isinstance(kwargs, dict):
        raise ValueError("Envelope field 'kwargs' must be a JSON object")

    return skill_dir, script_path, func_name, kwargs


def main() -> int:
    """Bridge entry point — return value is the process exit code."""
    try:
        envelope = _read_envelope()
        skill_dir, script_path, func_name, kwargs = _validate_envelope(envelope)
    except (ValueError, json.JSONDecodeError) as exc:
        # Malformed input — emit a structured error and exit non-zero.
        # Non-zero exit signals an unrecoverable bridge failure to the
        # Node side; the agent-facing error message comes from `error`.
        _emit(
            {
                "ok": False,
                "error": f"Invalid envelope: {exc}",
                "traceback": traceback.format_exc(),
            }
        )
        return 2

    full_path = (
        script_path
        if os.path.isabs(script_path)
        else os.path.join(skill_dir, script_path)
    )

    if not os.path.isfile(full_path):
        _emit(
            {
                "ok": False,
                "error": f"Script not found: {full_path}",
                "traceback": "",
            }
        )
        return 0

    try:
        func = _load_function(full_path, func_name)
    except (ImportError, AttributeError, SyntaxError, OSError) as exc:
        _emit(
            {
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
        return 0

    try:
        result = func(**kwargs)
    except BaseException as exc:  # noqa: BLE001 — surface any skill failure
        _emit(
            {
                "ok": False,
                "error": str(exc) or exc.__class__.__name__,
                "traceback": traceback.format_exc(),
            }
        )
        return 0

    try:
        # JSON-serialise eagerly so encoding failures surface as a
        # structured error rather than a crashed bridge.
        json.dumps(result)
    except TypeError as exc:
        _emit(
            {
                "ok": False,
                "error": f"Skill returned non-JSON-serialisable value: {exc}",
                "traceback": traceback.format_exc(),
            }
        )
        return 0

    _emit({"ok": True, "result": result})
    return 0


if __name__ == "__main__":
    sys.exit(main())
