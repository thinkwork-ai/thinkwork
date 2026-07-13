"""RFC 8785 (JCS) JSON canonicalization — byte-identical to canonical.ts.

The capability broker verifies Ed25519 signatures over the *canonical* bytes of a
domain-separated payload. The trusted host (Node) canonicalizes with
``@thinkwork/capability-contracts`` (``JSON.stringify`` + a UTF-16 key sort); this
module must produce the exact same UTF-8 bytes so a signature the SDK computes here
verifies there. Any divergence — one different digit in a number, a different key
order, a different escape — breaks proof-of-possession.

Parity is proven by ``test_canonical.py`` against ``shared-vectors.json``, the same
committed fixtures the TypeScript ``capability-sdk-parity.test.ts`` asserts against.

Design notes on the two subtle points:

* **Numbers** match ECMAScript ``Number::toString`` (the algorithm behind
  ``String(n)`` / ``JSON.stringify(n)``), NOT Python ``repr``. They agree on the
  shortest round-tripping *digits* (both use a Grisu/Ryu-style shortest form) but
  disagree on *notation* thresholds: JS emits ``1e+21`` where Python emits the same,
  but JS emits ``10000000000000000`` for ``1e16`` where Python ``repr`` emits
  ``1e+16``; JS emits ``0.000001`` where Python emits ``1e-06``. We take Python's
  shortest digits from ``repr`` and re-apply the ECMAScript formatting rules.

* **Key order** is by UTF-16 code unit (what JS ``Array.prototype.sort`` does), NOT
  by Unicode code point (Python's default ``str`` sort). They differ for astral
  characters: an emoji (U+1F600) sorts *before* U+FFFF in UTF-16 (its leading
  surrogate is 0xD83D) but *after* it by code point. Encoding each key to
  ``utf-16-be`` and comparing the byte sequences reproduces UTF-16 code-unit order.
"""

from __future__ import annotations

import hashlib
import math

__all__ = ["CanonicalizationError", "canonicalize", "sha256_hex"]


class CanonicalizationError(ValueError):
    """Raised when a value is not representable as canonical JSON (fail-closed).

    A fingerprint over silently coerced data would differ from the Node
    canonicalizer's, so non-JSON inputs (NaN, Infinity, bytes, sets, non-str keys,
    arbitrary objects) are rejected rather than coerced.
    """


# ---------------------------------------------------------------------------
# Number formatting — ECMAScript Number::toString
# ---------------------------------------------------------------------------


def _decompose(value: float) -> tuple[str, int]:
    """Return ``(digits, n)`` for a positive finite float.

    ``digits`` is the shortest significant-digit string (no leading/trailing zeros)
    and ``n`` is the ECMAScript exponent such that ``digits * 10**(n - len(digits))``
    equals ``value`` — i.e. ``n`` is the count of digits to the left of the decimal
    point in plain positional form.
    """
    rep = repr(value)
    if "e" in rep or "E" in rep:
        mantissa, _, exp_str = rep.replace("E", "e").partition("e")
        exp = int(exp_str)
    else:
        mantissa, exp = rep, 0
    int_part, _, frac_part = mantissa.partition(".")
    all_digits = int_part + frac_part
    stripped = all_digits.lstrip("0")
    leading_zeros = len(all_digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    # Power of ten of the first digit of ``all_digits`` is (len(int_part) - 1 + exp);
    # dropping ``leading_zeros`` shifts it down to the first significant digit.
    first_exp = (len(int_part) - 1) + exp - leading_zeros
    n = first_exp + 1
    return digits, n


def _number_to_string(value: float) -> str:
    """Serialize a finite number exactly as ECMAScript ``String(value)`` does."""
    if value == 0:  # covers both 0.0 and -0.0 -> "0"
        return "0"
    negative = value < 0
    if negative:
        value = -value
    digits, n = _decompose(value)
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
        exponent = n - 1
        sign = "+" if exponent >= 0 else "-"
        out = f"{mantissa}e{sign}{abs(exponent)}"
    return "-" + out if negative else out


# ---------------------------------------------------------------------------
# String escaping — minimal, matching JS JSON.stringify
# ---------------------------------------------------------------------------

_SHORT_ESCAPES = {
    0x08: "\\b",
    0x09: "\\t",
    0x0A: "\\n",
    0x0C: "\\f",
    0x0D: "\\r",
    0x22: '\\"',
    0x5C: "\\\\",
}


def _encode_string(value: str) -> str:
    """Quote+escape a string exactly as ``JSON.stringify`` does.

    Only ``"`` , ``\\`` and control characters ``< 0x20`` are escaped (the five
    named two-char escapes, everything else ``< 0x20`` as ``\\u00xx``). Characters
    ``>= 0x20`` — including all non-ASCII — are emitted literally as UTF-8.
    """
    out = ['"']
    for ch in value:
        code = ord(ch)
        short = _SHORT_ESCAPES.get(code)
        if short is not None:
            out.append(short)
        elif code < 0x20:
            out.append(f"\\u{code:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


# ---------------------------------------------------------------------------
# Recursive serialization
# ---------------------------------------------------------------------------


def _utf16_sort_key(key: str) -> bytes:
    # Comparing utf-16-be byte sequences == comparing UTF-16 code-unit sequences,
    # which is exactly what JS Array.prototype.sort uses for object keys.
    return key.encode("utf-16-be")


def _serialize(value: object, path: str) -> str:
    if value is None:
        return "null"
    # bool is a subclass of int — must be checked first.
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return _encode_string(value)
    if isinstance(value, int):
        # Match JS, which has only IEEE-754 doubles: widen to float first so an int
        # beyond 2**53 loses precision the same way JSON.parse would in Node.
        try:
            as_float = float(value)
        except OverflowError as exc:  # pragma: no cover - astronomically large int
            raise CanonicalizationError(f"integer out of range at {path}") from exc
        if not math.isfinite(as_float):  # pragma: no cover
            raise CanonicalizationError(f"integer out of range at {path}")
        return _number_to_string(as_float)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalizationError(f"non-finite number at {path}")
        return _number_to_string(value)
    if isinstance(value, (list, tuple)):
        items = [_serialize(item, f"{path}[{i}]") for i, item in enumerate(value)]
        return "[" + ",".join(items) + "]"
    if isinstance(value, dict):
        members = []
        for key in sorted(value.keys(), key=_utf16_sort_key):
            if not isinstance(key, str):
                raise CanonicalizationError(f"non-string object key at {path}")
            members.append(f"{_encode_string(key)}:{_serialize(value[key], f'{path}.{key}')}")
        return "{" + ",".join(members) + "}"
    raise CanonicalizationError(f"unsupported {type(value).__name__} at {path}")


def canonicalize(value: object) -> str:
    """Canonicalize a JSON value per RFC 8785 and return the canonical UTF-8 string."""
    return _serialize(value, "$")


def sha256_hex(value: object) -> str:
    """SHA-256 of the RFC 8785 canonical form, as lowercase hex."""
    return hashlib.sha256(canonicalize(value).encode("utf-8")).hexdigest()
