from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import handler as runner


def encoded(value: str) -> str:
    return base64.b64encode(value.encode()).decode()


def test_run_scan_writes_files_and_returns_skillspector_report(monkeypatch, tmp_path):
    calls = []

    def fake_run(command, check, capture_output, text, timeout):
        calls.append(
            {
                "command": command,
                "check": check,
                "capture_output": capture_output,
                "text": text,
                "timeout": timeout,
            }
        )
        report_path = Path(command[-1])
        report_path.write_text(
            json.dumps(
                {
                    "risk_assessment": {
                        "score": 0,
                        "severity": "LOW",
                        "recommendation": "INSTALL",
                    },
                    "issues": [],
                    "metadata": {"skillspector_version": "2.2.3"},
                }
            )
        )
        skill_dir = Path(command[2])
        assert (skill_dir / "SKILL.md").read_text() == "---\nname: safe-skill\n---\n"
        return type("Completed", (), {"returncode": 0, "stdout": "ok", "stderr": ""})()

    monkeypatch.setattr(runner.subprocess, "run", fake_run)
    monkeypatch.setenv("SKILLSPECTOR_TIMEOUT_SECONDS", "7")

    result = runner.run_scan(
        {
            "slug": "safe-skill",
            "files": [
                {
                    "path": "SKILL.md",
                    "contentBase64": encoded("---\nname: safe-skill\n---\n"),
                }
            ],
        }
    )

    assert result == {
        "report": {
            "risk_assessment": {
                "score": 0,
                "severity": "LOW",
                "recommendation": "INSTALL",
            },
            "issues": [],
            "metadata": {"skillspector_version": "2.2.3"},
        },
        "exitCode": 0,
        "stdout": "ok",
        "stderr": "",
    }
    assert calls[0]["command"][0:5] == [
        "skillspector",
        "scan",
        calls[0]["command"][2],
        "--no-llm",
        "--format",
    ]
    assert calls[0]["timeout"] == 7


@pytest.mark.parametrize(
    "event,error",
    [
        ({"slug": "../escape", "files": []}, "slug must be a portable skill name"),
        ({"slug": "safe-skill", "files": []}, "files must be a non-empty list"),
        (
            {
                "slug": "safe-skill",
                "files": [{"path": "../escape", "contentBase64": encoded("x")}],
            },
            "unsafe file path: ../escape",
        ),
        (
            {
                "slug": "safe-skill",
                "files": [{"path": "SKILL.md", "contentBase64": "not base64"}],
            },
            "invalid base64 for SKILL.md",
        ),
    ],
)
def test_run_scan_rejects_unsafe_inputs(event, error):
    with pytest.raises(runner.RunnerInputError, match=error):
        runner.run_scan(event)


def test_handler_converts_input_errors_to_lambda_payload():
    assert runner.handler({"slug": "../escape", "files": []}, None) == {
        "error": "slug must be a portable skill name"
    }
