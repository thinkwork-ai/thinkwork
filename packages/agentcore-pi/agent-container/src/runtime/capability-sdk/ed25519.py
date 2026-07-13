"""Pure-stdlib Ed25519 signing per RFC 8032, for the capability-broker SDK.

Python 3.12's standard library has no Ed25519 primitive, and the default AgentCore
Code Interpreter image has no pip and no network egress, so nothing beyond the
stdlib is importable. This is the RFC 8032 section 7 reference implementation
approach: ``hashlib.sha512`` plus integer arithmetic over the edwards25519 curve.

The SDK is the CLIENT: it SIGNS. The Node broker VERIFIES with ``node:crypto``.
Ed25519 signatures are deterministic, so for a given (seed, message) this module and
``node:crypto`` produce the identical 64-byte signature — proven in
``test_ed25519.py`` (RFC 8032 section 7.1 vectors) and cross-checked Python-sign ->
Node-verify in ``capability-sdk-parity.test.ts``.

Constant-time behaviour is NOT a goal: the key is an ephemeral, per-session,
<=15-minute capability held only inside the sandbox. Correctness is the goal.
"""

from __future__ import annotations

import hashlib

__all__ = [
    "SEED_LENGTH",
    "SIGNATURE_LENGTH",
    "public_key_from_seed",
    "seed_from_pkcs8_der",
    "sign",
    "verify",
]

SEED_LENGTH = 32
SIGNATURE_LENGTH = 64

# edwards25519 curve constants (RFC 8032 section 5.1).
_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)  # sqrt(-1) mod p
# Base point B.
_BY = (4 * pow(5, _P - 2, _P)) % _P
_BX = 0  # recovered below


def _sha512(data: bytes) -> bytes:
    return hashlib.sha512(data).digest()


def _sha512_int(data: bytes) -> int:
    return int.from_bytes(_sha512(data), "little")


def _inv(x: int) -> int:
    return pow(x, _P - 2, _P)


def _x_recover(y: int) -> int:
    xx = (y * y - 1) * _inv(_D * y * y + 1)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P != 0:
        x = (x * _I) % _P
    if x % 2 != 0:
        x = _P - x
    return x


_BX = _x_recover(_BY)
# Base point in extended homogeneous coordinates (X, Y, Z, T).
_B = (_BX % _P, _BY % _P, 1, (_BX * _BY) % _P)


def _edwards_add(p: tuple[int, int, int, int], q: tuple[int, int, int, int]):
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = ((y1 - x1) * (y2 - x2)) % _P
    b = ((y1 + x1) * (y2 + x2)) % _P
    c = (t1 * 2 * _D * t2) % _P
    dd = (z1 * 2 * z2) % _P
    e = b - a
    f = dd - c
    g = dd + c
    h = b + a
    return ((e * f) % _P, (g * h) % _P, (f * g) % _P, (e * h) % _P)


def _scalar_mult(p: tuple[int, int, int, int], e: int):
    q = (0, 1, 1, 0)  # neutral element
    while e > 0:
        if e & 1:
            q = _edwards_add(q, p)
        p = _edwards_add(p, p)
        e >>= 1
    return q


def _encode_point(p: tuple[int, int, int, int]) -> bytes:
    x, y, z, _ = p
    zi = _inv(z)
    x = (x * zi) % _P
    y = (y * zi) % _P
    encoded = y | ((x & 1) << 255)
    return encoded.to_bytes(32, "little")


def _is_on_curve(p: tuple[int, int, int, int]) -> bool:
    x, y, z, t = p
    return (
        (x * y - z * t) % _P == 0
        and (-x * x + y * y - z * z - _D * t * t) % _P == 0
    )


def _decode_point(data: bytes) -> tuple[int, int, int, int]:
    value = int.from_bytes(data, "little")
    y = value & ((1 << 255) - 1)
    sign = value >> 255
    if y >= _P:
        raise ValueError("point decode: y out of range")
    x = _x_recover(y)
    if x & 1 != sign:
        x = _P - x
    point = (x, y, 1, (x * y) % _P)
    if not _is_on_curve(point):
        raise ValueError("point decode: not on curve")
    return point


def _secret_expand(seed: bytes) -> tuple[int, bytes]:
    if len(seed) != SEED_LENGTH:
        raise ValueError("seed must be 32 bytes")
    h = _sha512(seed)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8  # clear low 3 bits
    a |= 1 << 254  # set high bit
    return a, h[32:]


def public_key_from_seed(seed: bytes) -> bytes:
    """Return the 32-byte Ed25519 public key for a 32-byte seed."""
    a, _ = _secret_expand(seed)
    return _encode_point(_scalar_mult(_B, a))


def sign(message: bytes, seed: bytes) -> bytes:
    """Sign ``message`` with the 32-byte ``seed``; return the 64-byte signature."""
    a, prefix = _secret_expand(seed)
    public = _encode_point(_scalar_mult(_B, a))
    r = _sha512_int(prefix + message) % _L
    big_r = _encode_point(_scalar_mult(_B, r))
    k = _sha512_int(big_r + public + message) % _L
    s = (r + k * a) % _L
    return big_r + s.to_bytes(32, "little")


def verify(signature: bytes, message: bytes, public_key: bytes) -> bool:
    """Verify a 64-byte Ed25519 signature. Used for the module self-test."""
    if len(signature) != SIGNATURE_LENGTH or len(public_key) != 32:
        return False
    try:
        big_r = signature[:32]
        s = int.from_bytes(signature[32:], "little")
        if s >= _L:
            return False
        point_a = _decode_point(public_key)
        point_r = _decode_point(big_r)
        k = _sha512_int(big_r + public_key + message) % _L
        left = _scalar_mult(_B, s)
        right = _edwards_add(point_r, _scalar_mult(point_a, k))
    except ValueError:
        return False
    # Compare in affine coordinates (projective reps of equal points differ).
    return _encode_point(left) == _encode_point(right)


# ---------------------------------------------------------------------------
# PKCS#8 seed extraction
# ---------------------------------------------------------------------------

# Node's generateKeyPairSync("ed25519").export({format:"der",type:"pkcs8"}) emits a
# fixed 48-byte structure: a 16-byte prefix then the 32-byte seed as the inner
# CurvePrivateKey OCTET STRING.
_PKCS8_ED25519_PREFIX = bytes.fromhex("302e020100300506032b657004220420")


def seed_from_pkcs8_der(der: bytes) -> bytes:
    """Extract the 32-byte seed from a PKCS#8 DER Ed25519 private key.

    Accepts the canonical 48-byte encoding Node emits. Fails closed on anything
    that is not exactly the expected prefix + 32-byte seed.
    """
    if (
        len(der) != len(_PKCS8_ED25519_PREFIX) + SEED_LENGTH
        or der[: len(_PKCS8_ED25519_PREFIX)] != _PKCS8_ED25519_PREFIX
    ):
        raise ValueError("unexpected PKCS#8 Ed25519 encoding")
    return der[len(_PKCS8_ED25519_PREFIX) :]
