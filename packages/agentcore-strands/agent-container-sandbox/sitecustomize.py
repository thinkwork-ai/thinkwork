"""sitecustomize — primary R13 token redactor for the AgentCore sandbox base image.

Python auto-imports any module named ``sitecustomize`` during interpreter
startup (before user code, before the preamble, before framework tracebacks on
cold start). This file installs a stdio write-wrapper keyed on a session-scoped
set of token values so no token leaks to stdout / stderr via Python-stdio
writes.

The invariant is honestly scoped per the brainstorm's R13 (as aligned in
docs/brainstorms/2026-04-22-agentcore-code-sandbox-requirements.md):

  "no token value reaches a persisted log ... via Python-stdio-mediated writes"

Bytes that bypass Python stdio (``os.write(fd, ...)``, subprocesses inheriting
fds, C extensions, multiprocessing children) are the named residual class
covered by the Unit 12 CloudWatch subscription-filter backstop for known
OAuth prefixes, not by this module.

Public API, callable from the sandbox preamble:
  register_token(value: str) -> None
  register_tokens(values: Iterable[str]) -> None
  clear_tokens() -> None
  installed() -> bool
"""

from __future__ import annotations

import base64
import binascii
import os
import sys
import urllib.parse
from typing import Any, Iterable, List, Set

# ---------------------------------------------------------------------------
# Module state
# ---------------------------------------------------------------------------

# Every unique byte-sequence we redact. Populated by ``register_token`` — each
# registered token expands into its cleartext, standard base64, URL-safe
# base64, URL-encoded, and hex forms (only the forms whose length is at least
# MIN_TOKEN_LEN, to avoid redacting short accidental matches like "AQ").
_redactions: Set[bytes] = set()

# Redaction placeholder. Length unimportant — stream layout survives because
# writes stay synchronous.
_REDACTION = b"<redacted>"

# Forms shorter than this are rejected — redacting 3-character strings is the
# shape of a wildcard bug, not a security control.
MIN_TOKEN_LEN = 12

# Rolling-suffix buffer size. Set at ``register_token`` time to
# max(existing, 2 * len(new_token_form)). The wrapper keeps this many bytes
# from the previous write and prepends them to the current write before
# searching, so a token split across two ``write()`` calls is caught as long
# as neither split half exceeds the buffer. Adversarial fragmentation at
# arbitrary positions is a named residual (see R13).
_rolling_buffer_size: int = 0


def _expand(value: str) -> List[bytes]:
    """Return the encoded forms of a token value we treat as equivalent.

    Each form is added to the redaction set so ``print(base64.b64encode(token))``
    and the cleartext ``print(token)`` are both scrubbed.
    """
    if not value:
        return []
    raw = value.encode("utf-8")
    forms: List[bytes] = []

    def maybe_add(candidate: bytes) -> None:
        if len(candidate) >= MIN_TOKEN_LEN:
            forms.append(candidate)

    maybe_add(raw)
    maybe_add(base64.b64encode(raw).rstrip(b"="))
    maybe_add(base64.b64encode(raw))
    maybe_add(base64.urlsafe_b64encode(raw).rstrip(b"="))
    maybe_add(base64.urlsafe_b64encode(raw))
    maybe_add(urllib.parse.quote(value, safe="").encode("ascii"))
    maybe_add(binascii.hexlify(raw))
    return forms


def register_token(value: str) -> None:
    """Add a token (and its derived encodings) to the redaction set.

    Safe to call multiple times with the same value. No-op for empty values.
    """
    global _rolling_buffer_size
    for form in _expand(value):
        _redactions.add(form)
        required = 2 * len(form)
        if required > _rolling_buffer_size:
            _rolling_buffer_size = required


def register_tokens(values: Iterable[str]) -> None:
    for v in values:
        register_token(v)


def clear_tokens() -> None:
    """Drop every registered token. Called at session teardown by the container."""
    global _rolling_buffer_size
    _redactions.clear()
    _rolling_buffer_size = 0


# ---------------------------------------------------------------------------
# Stdio wrapper
# ---------------------------------------------------------------------------


def _redact(chunk: bytes, tail_buffer: bytearray) -> tuple[bytes, bytearray]:
    """Return (scrubbed_output_chunk, new_tail_buffer).

    The tail buffer holds the trailing N bytes of the previous write so we can
    catch tokens split across write boundaries. The output we emit is the part
    of ``tail_buffer + chunk`` that is safely past the trailing window; the
    suffix stays in the new tail for the next call.
    """
    if not _redactions:
        return chunk, tail_buffer

    combined = bytes(tail_buffer) + chunk
    for form in _redactions:
        combined = combined.replace(form, _REDACTION)

    if _rolling_buffer_size and len(combined) > _rolling_buffer_size:
        emit = combined[: -_rolling_buffer_size]
        new_tail = bytearray(combined[-_rolling_buffer_size:])
    else:
        emit = b""
        new_tail = bytearray(combined)

    return emit, new_tail


class _RedactingStream:
    """Wraps sys.stdout / sys.stderr's underlying buffer with a redactor.

    Intercepts both ``write(str)`` (TextIOBase) and ``.buffer.write(bytes)``
    paths so ``print(...)``, ``sys.stdout.write(...)``, and
    ``sys.stdout.buffer.write(...)`` all flow through the scrubber.
    """

    def __init__(self, wrapped: Any, name: str) -> None:
        self._wrapped = wrapped
        self._name = name
        self._tail = bytearray()
        # AgentCore writes to stdout/stderr line-buffered; we flush our tail
        # on every newline-terminated write so output appears promptly.

    def write(self, data: Any) -> int:
        if isinstance(data, str):
            payload = data.encode("utf-8", errors="replace")
            wrote_str = True
        elif isinstance(data, (bytes, bytearray, memoryview)):
            payload = bytes(data)
            wrote_str = False
        else:
            # Defer unknown types to the wrapped object — let it raise.
            return self._wrapped.write(data)

        emit, self._tail = _redact(payload, self._tail)
        # A newline forces a tail flush so output doesn't lag arbitrarily when
        # no new writes arrive. This is a UX concession, not a security one —
        # redaction is complete whether we flush or not.
        if b"\n" in payload:
            emit = emit + bytes(self._tail)
            self._tail = bytearray()

        if not emit:
            return len(data) if wrote_str else len(payload)

        if wrote_str:
            self._wrapped.write(emit.decode("utf-8", errors="replace"))
        else:
            # TextIOWrapper.write raises on bytes; prefer the underlying buffer.
            buf = getattr(self._wrapped, "buffer", None)
            if buf is not None:
                buf.write(emit)
            else:
                self._wrapped.write(emit)
        return len(data) if wrote_str else len(payload)

    def flush(self) -> None:
        if self._tail:
            data = bytes(self._tail)
            self._tail = bytearray()
            buf = getattr(self._wrapped, "buffer", None)
            if buf is not None:
                buf.write(data)
            else:
                self._wrapped.write(data.decode("utf-8", errors="replace"))
        self._wrapped.flush()

    # Forward any other attribute access (fileno, isatty, encoding, etc.) so
    # libraries that introspect the stream still see what they expect.
    def __getattr__(self, item: str) -> Any:
        return getattr(self._wrapped, item)


_installed = False


def installed() -> bool:
    return _installed


def _install() -> None:
    global _installed
    if _installed:
        return
    sys.stdout = _RedactingStream(sys.stdout, "stdout")
    sys.stderr = _RedactingStream(sys.stderr, "stderr")
    _installed = True


# Install unconditionally on import. Disable only for a pytest diagnostic
# marker the test suite can opt out of (set THINKWORK_SANDBOX_SCRUBBER=off).
if os.environ.get("THINKWORK_SANDBOX_SCRUBBER", "on") != "off":
    _install()
