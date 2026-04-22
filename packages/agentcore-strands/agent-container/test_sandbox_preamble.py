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


def _inputs(**overrides):
    defaults = dict(
        tenant_id="11111111-2222-3333-4444-555555555555",
        user_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        stage="dev",
        secret_paths={
            "github": (
                "arn:aws:secretsmanager:us-east-1:123456789012:secret:"
                "thinkwork/dev/sandbox/t/u/oauth/github"
            ),
            "slack": (
                "arn:aws:secretsmanager:us-east-1:123456789012:secret:"
                "thinkwork/dev/sandbox/t/u/oauth/slack"
            ),
        },
    )
    defaults.update(overrides)
    return sp.PreambleInputs(**defaults)


def test_preamble_version_comment_is_present():
    src = sp.build_preamble(_inputs())
    assert f"thinkwork_preamble_version: {sp.PREAMBLE_VERSION}" in src


def test_preamble_source_is_valid_python():
    src = sp.build_preamble(_inputs())
    # If the interpolation produces malformed Python, this raises.
    ast.parse(src)


def test_preamble_references_sitecustomize_install_check():
    src = sp.build_preamble(_inputs())
    assert "sitecustomize" in src
    assert ".installed()" in src


def test_preamble_reads_secrets_via_boto3():
    src = sp.build_preamble(_inputs())
    assert 'boto3.client("secretsmanager")' in src or "boto3.client('secretsmanager')" in src
    assert "get_secret_value" in src


def test_preamble_registers_values_with_redactor_before_export():
    src = sp.build_preamble(_inputs())
    idx_register = src.index("register_token")
    idx_env = src.index("_tw_os.environ[")
    # Registration must happen before os.environ assignment; otherwise
    # a print() inside the registration block would leak.
    assert idx_register < idx_env


def test_preamble_emits_env_var_names_matching_typed_skills():
    src = sp.build_preamble(_inputs())
    # The TS side uses the same GITHUB_ACCESS_TOKEN / SLACK_ACCESS_TOKEN
    # variable names; script skills (buildSkillEnvOverrides) match.
    assert "GITHUB_ACCESS_TOKEN" in src
    assert "SLACK_ACCESS_TOKEN" in src


def test_preamble_never_contains_a_raw_token_value():
    """Path-only: no token value ever reaches the preamble source.

    The dispatcher writes fresh tokens to SM separately; the preamble
    reads them at runtime inside the sandbox. A misguided refactor
    that tried to bake a value into the source would fail this test.
    """
    src = sp.build_preamble(
        _inputs(
            secret_paths={
                "github": (
                    "arn:aws:secretsmanager:us-east-1:123456789012:secret:"
                    "thinkwork/dev/sandbox/t/u/oauth/github-AbCdEf"
                ),
            },
        ),
    )
    # Canonical cleartext shapes we worry about leaking.
    for shape in ("ghp_", "gho_", "xoxb-", "xoxp-", "ya29."):
        assert shape not in src, f"preamble source contained sensitive prefix {shape}"


def test_preamble_no_connections_still_parses_and_emits_ready_marker():
    src = sp.build_preamble(_inputs(secret_paths={}))
    ast.parse(src)
    assert "__thinkwork_sandbox_ready__" in src


def test_preamble_silently_ignores_unknown_connection_types():
    # If the dispatcher somehow passes an unknown connection type, the
    # preamble must not emit it as an env-var (unmapped name would
    # collide with unrelated variables). The invariant ships a strict
    # allowlist: github / slack / google today.
    src = sp.build_preamble(_inputs(secret_paths={"notion": "arn:..."}))
    assert "NOTION_ACCESS_TOKEN" not in src
    assert "notion" not in src
    ast.parse(src)


def test_preamble_ready_marker_is_flushed():
    # AgentCore's APPLICATION_LOGS won't show the marker until flush —
    # the dispatcher greps for it to confirm call #1 completed before
    # sending call #2.
    src = sp.build_preamble(_inputs())
    assert "flush=True" in src
