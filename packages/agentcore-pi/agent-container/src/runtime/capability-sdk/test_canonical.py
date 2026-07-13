"""Cross-language canonicalization + client-payload parity (THINK-280 U4).

Asserts the Python canonicalizer produces byte-identical output to the committed
``shared-vectors.json`` — the same fixtures the TypeScript
``capability-sdk-parity.test.ts`` asserts against the Node canonicalizer. When both
pass, Python and Node agree byte-for-byte, which is the precondition for a Python
signature verifying at the Node broker.
"""

from __future__ import annotations

import base64
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _loader import load_sdk, vectors_path  # noqa: E402

canonical, ed25519, client = load_sdk()

_VECTORS = json.loads(vectors_path().read_text(encoding="utf-8"))


def test_canonical_vectors_are_byte_identical() -> None:
    for vector in _VECTORS["canonical"]:
        assert canonical.canonicalize(vector["value"]) == vector["canonical"], vector["name"]
        assert canonical.sha256_hex(vector["value"]) == vector["sha256Hex"], vector["name"]


def test_simple_key_order() -> None:
    assert canonical.canonicalize({"b": 2, "a": 1}) == '{"a":1,"b":2}'


def test_number_edge_cases_match_es2015() -> None:
    # The JS Number->string thresholds Python repr does NOT reproduce on its own.
    assert canonical.canonicalize(1.0) == "1"
    assert canonical.canonicalize(1e21) == "1e+21"
    assert canonical.canonicalize(0.000001) == "0.000001"
    assert canonical.canonicalize(1e-7) == "1e-7"
    assert canonical.canonicalize(1e16) == "10000000000000000"
    assert canonical.canonicalize(-0.0) == "0"
    assert canonical.canonicalize(333333333.33333329) == "333333333.3333333"
    assert canonical.canonicalize(100) == "100"


def test_utf16_key_ordering_beats_codepoint_ordering() -> None:
    # z(0x7A) < emoji(lead surrogate 0xD83D) < U+FFFF by UTF-16 code unit; a naive
    # code-point sort would place U+FFFF before the astral emoji.
    value = {"￿": "bmp-max", "\U0001f600": "astral", "z": "ascii"}
    assert canonical.canonicalize(value) == '{"z":"ascii","\U0001f600":"astral","￿":"bmp-max"}'


def test_rejects_non_json_and_non_finite() -> None:
    import math

    for bad in (float("nan"), float("inf"), -float("inf")):
        try:
            canonical.canonicalize(bad)
        except canonical.CanonicalizationError:
            pass
        else:  # pragma: no cover
            raise AssertionError("expected CanonicalizationError")
    for bad in (b"bytes", {1, 2}, object()):
        try:
            canonical.canonicalize(bad)
        except canonical.CanonicalizationError:
            pass
        else:  # pragma: no cover
            raise AssertionError("expected CanonicalizationError")
    assert math.isnan(float("nan"))


def test_call_payload_signable_matches_node() -> None:
    """The client's signable payload must be byte-identical to buildSignableCallPayload."""
    vector = next(v for v in _VECTORS["signatures"] if v["kind"] == "call")
    request = vector["request"]
    payload = {
        "kind": client.BROKER_REQUEST_KIND,
        "audience": vector["audience"],
        "sessionId": request["sessionId"],
        "clientRequestId": request["clientRequestId"],
        "sequence": request["sequence"],
        "nonce": request["nonce"],
        "issuedAt": request["issuedAt"],
        "operation": request["operation"],
        "bodyHash": canonical.sha256_hex(request["input"]),
    }
    assert canonical.canonicalize(payload) == vector["signableString"]


def test_client_signs_call_payload_matching_node_signature() -> None:
    """End-to-end: build the payload as the client does, sign, match Node's sig."""
    vector = next(v for v in _VECTORS["signatures"] if v["kind"] == "call")
    seed = ed25519.seed_from_pkcs8_der(base64.b64decode(vector["privateKeyPkcs8B64"]))
    signature = ed25519.sign(vector["signableString"].encode("utf-8"), seed)
    assert base64.b64encode(signature).decode("ascii") == vector["signatureB64"]
