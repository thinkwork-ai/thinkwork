"""Unit tests for sandbox_preamble.build_preamble — pure string
generation, exercised by ast.parse to confirm the emitted source is
actually valid Python and matches the documented shape.
"""

from __future__ import annotations

import ast
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import sandbox_preamble as sp  # type: ignore  # noqa: E402


def test_preamble_version_comment_is_present():
    src = sp.build_preamble()
    assert f"thinkwork_preamble_version: {sp.PREAMBLE_VERSION}" in src


def test_preamble_version_is_v2_after_oauth_removal():
    assert sp.PREAMBLE_VERSION == 2


def test_preamble_source_is_valid_python():
    src = sp.build_preamble()
    # If the emitted source is malformed Python, ast.parse raises.
    ast.parse(src)


def test_preamble_references_sitecustomize_install_check():
    src = sp.build_preamble()
    assert "sitecustomize" in src
    assert ".installed()" in src


def test_preamble_emits_ready_marker_flushed():
    src = sp.build_preamble()
    assert "__thinkwork_sandbox_ready__" in src
    # AgentCore's APPLICATION_LOGS won't show the marker until flush —
    # the dispatcher greps for it to confirm call #1 completed before
    # sending call #2.
    assert "flush=True" in src


# ---------------------------------------------------------------------------
# Regression guards — the OAuth preamble path is retired. These tests exist
# so a refactor that tried to reintroduce boto3 / SecretString reads / env
# exports fails loud. See docs/plans/2026-04-23-006.
# ---------------------------------------------------------------------------


def test_preamble_does_not_import_boto3():
    src = sp.build_preamble()
    assert "boto3" not in src


def test_preamble_does_not_read_secrets_manager():
    src = sp.build_preamble()
    assert "get_secret_value" not in src
    assert "SecretId" not in src
    assert "SecretString" not in src


def test_preamble_does_not_mutate_os_environ():
    src = sp.build_preamble()
    assert "os.environ[" not in src
    assert "_tw_os.environ[" not in src


def test_preamble_does_not_reference_oauth_env_var_names():
    src = sp.build_preamble()
    for name in ("GITHUB_ACCESS_TOKEN", "SLACK_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN"):
        assert name not in src, f"preamble source mentions retired env var {name}"


def test_preamble_does_not_embed_token_prefixes():
    src = sp.build_preamble()
    for shape in ("ghp_", "gho_", "xoxb-", "xoxp-", "ya29."):
        assert shape not in src, f"preamble source mentions token prefix {shape}"
