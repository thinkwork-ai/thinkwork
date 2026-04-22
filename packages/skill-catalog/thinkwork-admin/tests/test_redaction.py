"""Contract tests for Unit 12's audit emission + secret redaction.

Two invariant classes:

1. `emit()` writes exactly one STRUCTURED_LOG line carrying the full
   R20 field set (invoker / agent / operation / args / status / reason
   / latency) with a timestamp and the tenant-prefixed log_stream.
2. The R21 negative test: no pass-through from args → stdout can leak
   a secret. Three independent redaction passes are exercised: key-
   name, value-shape, exact-value. The R21 assertion scans the entire
   captured output and asserts the raw secret literal never appears.
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.normpath(os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, SCRIPTS_DIR)

import audit  # noqa: E402


SECRET = "s3cret-THINKWORK-api-value-do-not-log-9b2f"


def _capture(fn, secret_env: str | None = SECRET) -> str:
    stream = io.StringIO()
    prior = os.environ.get("THINKWORK_API_SECRET")
    if secret_env is not None:
        os.environ["THINKWORK_API_SECRET"] = secret_env
    else:
        os.environ.pop("THINKWORK_API_SECRET", None)
    try:
        fn(stream)
    finally:
        if prior is None:
            os.environ.pop("THINKWORK_API_SECRET", None)
        else:
            os.environ["THINKWORK_API_SECRET"] = prior
    return stream.getvalue()


def _parse_log(captured: str) -> dict:
    """Pull the JSON body out of a STRUCTURED_LOG line."""
    for line in captured.splitlines():
        if line.startswith("STRUCTURED_LOG "):
            return json.loads(line[len("STRUCTURED_LOG ") :])
    raise AssertionError(f"No STRUCTURED_LOG line in: {captured!r}")


class EmitShapeTests(unittest.TestCase):
    def test_success_emits_all_r20_fields(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="admin-1",
                invoker_role="admin",
                agent_id="agent-1",
                agent_tenant_id="tenant-A",
                operation_name="create_agent",
                arguments={"name": "Marco", "slug": "marco"},
                status="success",
                latency_ms=42,
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["event_type"], "admin_mutation")
        self.assertEqual(entry["log_stream"], "tenant_tenant-A")
        self.assertEqual(entry["invoker_user_id"], "admin-1")
        self.assertEqual(entry["invoker_role"], "admin")
        self.assertEqual(entry["agent_id"], "agent-1")
        self.assertEqual(entry["agent_tenant_id"], "tenant-A")
        self.assertEqual(entry["operation_name"], "create_agent")
        self.assertEqual(entry["status"], "success")
        self.assertIsNone(entry["refusal_reason"])
        self.assertEqual(entry["latency_ms"], 42)
        self.assertIn("timestamp", entry)

    def test_refusal_carries_reason_code(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="admin-1",
                invoker_role="admin",
                agent_id="agent-1",
                agent_tenant_id="tenant-A",
                operation_name="remove_tenant_member",
                arguments={"id": "m-1"},
                status="refused",
                refusal_reason="allowlist_miss",
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["status"], "refused")
        self.assertEqual(entry["refusal_reason"], "allowlist_miss")

    def test_turn_count_included_when_provided(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="admin-1",
                invoker_role="admin",
                agent_id="agent-1",
                agent_tenant_id="tenant-A",
                operation_name="create_agent",
                arguments={},
                status="success",
                turn_count=17,
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["turn_count"], 17)


class KeyNameRedactionTests(unittest.TestCase):
    """Pass 1 — redact by field name regardless of value shape."""

    def _args(self, extra: dict) -> dict:
        return {"normal_field": "keep-me", **extra}

    def test_redacts_value_for_token_key(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="u",
                invoker_role="admin",
                agent_id="a",
                agent_tenant_id="t",
                operation_name="op",
                arguments=self._args({"api_token": "plaintext-value"}),
                status="success",
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["arguments_redacted"]["api_token"], audit.REDACTED)
        self.assertEqual(entry["arguments_redacted"]["normal_field"], "keep-me")

    def test_case_insensitive_key_match(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="u",
                invoker_role="admin",
                agent_id="a",
                agent_tenant_id="t",
                operation_name="op",
                arguments={"API_SECRET": "s", "Authorization": "Bearer xyz"},
                status="success",
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["arguments_redacted"]["API_SECRET"], audit.REDACTED)
        self.assertEqual(
            entry["arguments_redacted"]["Authorization"], audit.REDACTED
        )

    def test_redacts_nested_under_credentials_key(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="u",
                invoker_role="admin",
                agent_id="a",
                agent_tenant_id="t",
                operation_name="op",
                arguments={"credentials": {"username": "u", "password": "p"}},
                status="success",
                stream=stream,
            )
        )
        entry = _parse_log(out)
        # Parent-key match redacts the whole subtree — no leak of
        # "username" either, even though it wouldn't match the regex.
        self.assertEqual(entry["arguments_redacted"]["credentials"], audit.REDACTED)


class ValueShapeRedactionTests(unittest.TestCase):
    """Pass 2 — redact known secret shapes in neutrally-named keys."""

    def _emit(self, value: str) -> dict:
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="u",
                invoker_role="admin",
                agent_id="a",
                agent_tenant_id="t",
                operation_name="op",
                arguments={"metadata": value, "other": "safe"},
                status="success",
                stream=stream,
            )
        )
        return _parse_log(out)

    def test_jwt_in_neutral_key_gets_redacted(self):
        jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature-bytes"
        entry = self._emit(jwt)
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)
        self.assertEqual(entry["arguments_redacted"]["other"], "safe")

    def test_github_token_prefix_redacted(self):
        entry = self._emit("ghp_1234567890abcdefghijklmnopqrstuvwxyz")
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)

    def test_stripe_secret_key_prefix_redacted(self):
        entry = self._emit("sk_live_1234567890abcdefghij")
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)

    def test_slack_token_prefix_redacted(self):
        entry = self._emit("xoxb-1234567890-abc-def")
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)

    def test_bearer_prefix_redacted(self):
        entry = self._emit("Bearer abcdefghij0123456789")
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)

    def test_aws_access_key_id_redacted(self):
        entry = self._emit("AKIAIOSFODNN7EXAMPLE")
        self.assertEqual(entry["arguments_redacted"]["metadata"], audit.REDACTED)

    def test_safe_string_passes_through(self):
        entry = self._emit("Marco onboarding for Acme Corp")
        self.assertEqual(
            entry["arguments_redacted"]["metadata"],
            "Marco onboarding for Acme Corp",
        )


class ExactValueRedactionTests(unittest.TestCase):
    """Pass 3 — catch the service secret even in custom-named keys."""

    def test_service_secret_literal_redacted_via_exact_match(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="u",
                invoker_role="admin",
                agent_id="a",
                agent_tenant_id="t",
                operation_name="op",
                # Deliberately-neutral key + no recognizable shape;
                # pass 1 + 2 miss. Pass 3 catches it.
                arguments={"hint": SECRET, "other": "safe"},
                status="success",
                stream=stream,
            )
        )
        entry = _parse_log(out)
        self.assertEqual(entry["arguments_redacted"]["hint"], audit.REDACTED)
        self.assertEqual(entry["arguments_redacted"]["other"], "safe")


class R21NegativeTest(unittest.TestCase):
    """R21 — the secret value must NEVER appear in captured output.

    Stress-tests all three redaction passes jointly by scanning the
    complete STRUCTURED_LOG payload for the raw secret. Any leak —
    through a passthrough key, a shape the regex missed, or a
    serialization bug — fails the test.
    """

    def test_full_call_never_emits_raw_secret(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="admin-1",
                invoker_role="admin",
                agent_id="agent-1",
                agent_tenant_id="tenant-A",
                operation_name="create_agent",
                arguments={
                    # Exercises all three passes at once.
                    "name": "Marco",
                    "api_secret": SECRET,                     # pass 1
                    "metadata": f"Bearer {SECRET}",           # pass 2
                    "hint": SECRET,                           # pass 3
                    "nested": {
                        "token": SECRET,
                        "safe": "ok",
                    },
                },
                status="success",
                latency_ms=123,
                stream=stream,
            )
        )
        self.assertNotIn(
            SECRET,
            out,
            "R21 violation — raw service secret leaked into captured stdout",
        )

    def test_refused_call_never_emits_raw_secret_either(self):
        out = _capture(
            lambda stream: audit.emit(
                invoker_user_id="admin-1",
                invoker_role="admin",
                agent_id="agent-1",
                agent_tenant_id="tenant-A",
                operation_name="create_agent",
                arguments={"api_secret": SECRET},
                status="refused",
                refusal_reason="missing_admin_role",
                stream=stream,
            )
        )
        self.assertNotIn(SECRET, out)


if __name__ == "__main__":
    unittest.main()
