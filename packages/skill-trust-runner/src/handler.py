"""Lambda entrypoint for running NVIDIA SkillSpector against staged skill files."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

MAX_FILES = 256
MAX_BYTES = 5 * 1024 * 1024
OUTPUT_LIMIT = 8000
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")


class RunnerInputError(ValueError):
    """Raised when the GraphQL caller sends an invalid scan payload."""


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        return run_scan(event)
    except RunnerInputError as exc:
        return {"error": str(exc)}
    except Exception as exc:  # pragma: no cover - defensive Lambda boundary
        return {"error": f"SkillSpector runner failed: {exc}"}


def run_scan(event: dict[str, Any]) -> dict[str, Any]:
    slug = _required_string(event.get("slug"), "slug")
    if not SLUG_RE.fullmatch(slug):
        raise RunnerInputError("slug must be a portable skill name")
    files = event.get("files")
    if not isinstance(files, list) or not files:
        raise RunnerInputError("files must be a non-empty list")
    if len(files) > MAX_FILES:
        raise RunnerInputError(f"too many files: max {MAX_FILES}")

    total_bytes = 0
    with tempfile.TemporaryDirectory(prefix="thinkwork-skill-trust-") as root_dir:
        root = Path(root_dir)
        skill_dir = root / slug
        skill_dir.mkdir(parents=True, exist_ok=True)

        for raw_file in files:
            if not isinstance(raw_file, dict):
                raise RunnerInputError("each file must be an object")
            relative_path = _required_string(raw_file.get("path"), "file.path")
            content_base64 = _required_string(
                raw_file.get("contentBase64"), f"{relative_path}.contentBase64"
            )
            try:
                content = base64.b64decode(content_base64, validate=True)
            except Exception as exc:
                raise RunnerInputError(f"invalid base64 for {relative_path}") from exc
            total_bytes += len(content)
            if total_bytes > MAX_BYTES:
                raise RunnerInputError(f"skill payload exceeds {MAX_BYTES} bytes")

            target = (skill_dir / relative_path).resolve()
            if not target.is_relative_to(skill_dir.resolve()):
                raise RunnerInputError(f"unsafe file path: {relative_path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)

        report_path = root / "skillspector-report.json"
        command = [
            "skillspector",
            "scan",
            str(skill_dir),
            "--no-llm",
            "--format",
            "json",
            "-o",
            str(report_path),
        ]
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=int(os.environ.get("SKILLSPECTOR_TIMEOUT_SECONDS", "45")),
        )

        if report_path.exists() and report_path.stat().st_size > 0:
            return {
                "report": json.loads(report_path.read_text()),
                "exitCode": completed.returncode,
                "stdout": _truncate(completed.stdout),
                "stderr": _truncate(completed.stderr),
            }

        return {
            "error": _truncate(
                completed.stderr
                or completed.stdout
                or f"SkillSpector exited {completed.returncode} without a report"
            ),
            "exitCode": completed.returncode,
        }


def _required_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RunnerInputError(f"{field} is required")
    return value


def _truncate(value: str) -> str:
    if len(value) <= OUTPUT_LIMIT:
        return value
    return value[: OUTPUT_LIMIT - 3] + "..."
