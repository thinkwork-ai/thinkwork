"""Unit tests for the AgentCore sandbox base-image stdio token redactor.

Tests hit ``_RedactingStream`` directly with a test-owned stream instead of
mutating ``sys.stdout`` — that side-steps pytest's capture machinery, which
owns sys.stdout at test time and would otherwise see writes before the
wrapper does. Correctness of the sys.stdout replacement path is proven by
a separate end-to-end test that runs the module as a subprocess with its
auto-install path active.
"""

from __future__ import annotations

import base64
import binascii
import importlib.util
import io
import os
import subprocess
import sys
import urllib.parse

import pytest

os.environ["THINKWORK_SANDBOX_SCRUBBER"] = "off"

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location(
    "sandbox_base_sitecustomize",
    os.path.join(_HERE, "sitecustomize.py"),
)
assert _SPEC is not None and _SPEC.loader is not None
sc = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(sc)


class _StringSink:
    """Minimal sys.stdout-shaped target: the wrapper writes strings into us,
    we collect them as UTF-8 bytes. Also exposes ``.buffer`` so bytes-path
    writes have a path through the wrapper."""

    def __init__(self) -> None:
        self.str_bytes = bytearray()
        self.buffer = io.BytesIO()
        self.name = "test-sink"
        self.encoding = "utf-8"
        self.errors = "strict"

    def write(self, s: str) -> int:
        self.str_bytes.extend(s.encode("utf-8", errors="replace"))
        return len(s)

    def flush(self) -> None:
        pass

    def captured(self) -> str:
        combined = bytes(self.str_bytes) + self.buffer.getvalue()
        return combined.decode("utf-8", errors="replace")


@pytest.fixture
def wrapper() -> tuple:
    """A fresh redactor wrapping a new sink, with an empty token set."""
    sc.clear_tokens()
    sink = _StringSink()
    stream = sc._RedactingStream(sink, "test-stdout")  # type: ignore[attr-defined]
    yield stream, sink
    stream.flush()
    sc.clear_tokens()


def test_cleartext_is_redacted(wrapper):
    stream, sink = wrapper
    token = "ghp_abc123abc123abc123"
    sc.register_token(token)
    stream.write(f"the token was {token} and not noticeable\n")
    stream.flush()
    text = sink.captured()
    assert token not in text
    assert "<redacted>" in text
    assert "the token was" in text


def test_base64_form_is_redacted(wrapper):
    stream, sink = wrapper
    token = "ghp_abc123abc123abc123"
    sc.register_token(token)
    encoded = base64.b64encode(token.encode()).decode()
    stream.write(f"encoded={encoded}\n")
    stream.flush()
    text = sink.captured()
    assert encoded not in text
    assert "<redacted>" in text


def test_urlsafe_base64_form_is_redacted(wrapper):
    stream, sink = wrapper
    token = "some_opaque_secret_for_urlsafe"
    sc.register_token(token)
    encoded = base64.urlsafe_b64encode(token.encode()).decode()
    stream.write(f"encoded={encoded}\n")
    stream.flush()
    text = sink.captured()
    assert encoded not in text
    assert "<redacted>" in text


def test_url_encoded_form_is_redacted(wrapper):
    stream, sink = wrapper
    token = "token with spaces & special=chars"
    sc.register_token(token)
    encoded = urllib.parse.quote(token, safe="")
    stream.write(f"in_url={encoded}\n")
    stream.flush()
    text = sink.captured()
    assert encoded not in text
    assert "<redacted>" in text


def test_hex_form_is_redacted(wrapper):
    stream, sink = wrapper
    token = "0123456789abcdef01234567"
    sc.register_token(token)
    encoded = binascii.hexlify(token.encode()).decode()
    stream.write(f"hex={encoded}\n")
    stream.flush()
    text = sink.captured()
    assert encoded not in text
    assert "<redacted>" in text


def test_register_after_first_write_still_redacts_subsequent(wrapper):
    stream, sink = wrapper
    stream.write("before registration\n")
    token = "late_registered_token_value"
    sc.register_token(token)
    stream.write(f"after {token} registration\n")
    stream.flush()
    text = sink.captured()
    assert "before registration" in text
    assert token not in text
    assert "<redacted>" in text


def test_split_write_across_boundary_is_caught(wrapper):
    stream, sink = wrapper
    token = "ghp_splitfragmenttokenvalue"
    sc.register_token(token)
    stream.write(token[:10])
    stream.write(token[10:])
    stream.write("\n")
    stream.flush()
    text = sink.captured()
    assert token not in text
    assert "<redacted>" in text


def test_short_token_below_min_len_is_ignored(wrapper):
    """Redacting 3-char strings would produce wildcard false-positives."""
    stream, sink = wrapper
    sc.register_token("AQ")
    stream.write("AQ should appear unchanged because AQ is too short to redact\n")
    stream.flush()
    text = sink.captured()
    assert "AQ" in text
    assert "<redacted>" not in text


def test_bytes_path_through_buffer(wrapper):
    stream, sink = wrapper
    token = "some_token_value_we_registered"
    sc.register_token(token)
    # Write bytes through the wrapper — it routes into sink.buffer.
    stream.write(b"\x00\x01\x02binary with " + token.encode() + b" embedded\n")
    stream.flush()
    text = sink.captured()
    assert token not in text
    assert "<redacted>" in text
    assert "binary with" in text


def test_clear_tokens_disables_redaction_for_later_writes(wrapper):
    stream, sink = wrapper
    token = "a_token_that_will_be_cleared_soon"
    sc.register_token(token)
    stream.write(f"before clear: {token}\n")
    sc.clear_tokens()
    stream.write(f"after clear: {token}\n")
    stream.flush()
    text = sink.captured()
    assert text.count("<redacted>") == 1
    assert text.count(token) == 1


def test_register_tokens_plural_is_equivalent(wrapper):
    stream, sink = wrapper
    sc.register_tokens(["first_registered_token_abc", "second_registered_token_def"])
    stream.write("first_registered_token_abc / second_registered_token_def\n")
    stream.flush()
    text = sink.captured()
    assert "first_registered_token_abc" not in text
    assert "second_registered_token_def" not in text
    assert text.count("<redacted>") >= 2


def test_empty_token_is_ignored(wrapper):
    stream, sink = wrapper
    sc.register_token("")
    stream.write("nothing to redact here\n")
    stream.flush()
    text = sink.captured()
    assert "nothing to redact here" in text
    assert "<redacted>" not in text


def test_no_crash_on_raw_bytes_without_matching_token(wrapper):
    stream, sink = wrapper
    sc.register_token("something_registered_but_not_present")
    stream.write(b"\x00\x01\x02binary bytes\n")
    stream.flush()
    text = sink.captured()
    assert "binary bytes" in text


# --- End-to-end: the auto-install path ---------------------------------------
#
# Tests above exercise _RedactingStream directly, which is fine for the
# redaction logic itself but bypasses the sitecustomize auto-install step
# that replaces sys.stdout on interpreter startup. This subprocess test
# proves that step works — a fresh Python process, with PYTHONPATH pointed
# at the module directory and THINKWORK_SANDBOX_SCRUBBER unset, installs
# the wrapper on its own and redacts a registered token before stdout is
# flushed.


def test_auto_install_redacts_on_fresh_interpreter(tmp_path):
    script = tmp_path / "run.py"
    script.write_text(
        """
import sys, sitecustomize
sitecustomize.register_token("ghp_autoInstallValueTokenX")
print("auto-install redacts ghp_autoInstallValueTokenX mid-line here")
""".strip()
    )
    env = os.environ.copy()
    # Strip our opt-out so sitecustomize installs on import.
    env.pop("THINKWORK_SANDBOX_SCRUBBER", None)
    # Prepend the module dir so Python's startup hook finds our
    # sitecustomize.py before any installed one.
    env["PYTHONPATH"] = _HERE + os.pathsep + env.get("PYTHONPATH", "")
    out = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "ghp_autoInstallValueTokenX" not in out.stdout
    assert "<redacted>" in out.stdout
    assert "auto-install redacts" in out.stdout


def test_installed_reports_true_after_auto_install(tmp_path):
    """Probe ``installed()`` from a fresh interpreter — confirms the startup
    hook ran (and set the flag)."""
    script = tmp_path / "run.py"
    script.write_text("import sitecustomize; print(sitecustomize.installed())")
    env = os.environ.copy()
    env.pop("THINKWORK_SANDBOX_SCRUBBER", None)
    env["PYTHONPATH"] = _HERE + os.pathsep + env.get("PYTHONPATH", "")
    out = subprocess.run(
        [sys.executable, str(script)],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert out.stdout.strip() == "True"
