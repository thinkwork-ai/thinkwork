#!/usr/bin/env python3
"""Publish the applied Cognito route manifest to the auth control plane."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TF_DIR = REPO_ROOT / "terraform" / "examples" / "greenfield"
RUNNER_PATH = REPO_ROOT / "terraform" / "modules" / "app" / "deployment-control-plane" / "runner.py"


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for native auth reconciliation")
    return value


def load_deployment_runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("thinkwork_deployment_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load deployment runner from {RUNNER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    tf_dir = Path(os.environ.get("TF_DIR", DEFAULT_TF_DIR)).resolve()
    outputs = subprocess.check_output(
        ["terraform", "output", "-json"],
        cwd=tf_dir,
        text=True,
    )
    # Parse before handing the document to the shared reconciler so malformed
    # or incomplete Terraform output fails before any API or SSM mutation.
    json.loads(outputs)

    vars_json = {
        "stage": required_env("STAGE"),
        "region": required_env("AWS_REGION"),
        "account_id": required_env("AWS_ACCOUNT_ID"),
        "api_auth_secret": required_env("API_AUTH_SECRET"),
        "microsoft_oauth_tenant": required_env("MICROSOFT_OAUTH_TENANT"),
    }
    runner = load_deployment_runner()
    with TemporaryDirectory(prefix="thinkwork-auth-reconcile-") as temp_dir:
        outputs_path = Path(temp_dir) / "outputs.json"
        outputs_path.write_text(outputs, encoding="utf-8")
        result = runner.reconcile_native_auth_metadata(outputs_path, vars_json)

    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
