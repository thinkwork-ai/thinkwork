"""Ed25519 correctness + client behaviour (THINK-280 U4).

Correctness is anchored to the RFC 8032 section 7.1 test vectors (known-correct,
provider-independent) carried in ``shared-vectors.json``. Because Ed25519 is
deterministic, the same (seed, message) yields the identical signature here and in
``node:crypto`` — the committed ``signatureHex`` values were emitted by the Node
oracle and match RFC 8032, so a green test proves Python == RFC == Node.
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
_RAW = [v for v in _VECTORS["signatures"] if v["kind"] == "raw"]


def test_rfc8032_public_keys() -> None:
    for vector in _RAW:
        seed = bytes.fromhex(vector["seedHex"])
        assert ed25519.public_key_from_seed(seed).hex() == vector["publicKeyRawHex"], vector[
            "name"
        ]


def test_rfc8032_signatures_are_deterministic_and_correct() -> None:
    for vector in _RAW:
        seed = bytes.fromhex(vector["seedHex"])
        message = bytes.fromhex(vector["messageHex"])
        signature = ed25519.sign(message, seed)
        assert signature.hex() == vector["signatureHex"], vector["name"]
        assert len(signature) == ed25519.SIGNATURE_LENGTH


def test_self_verify_roundtrip() -> None:
    for vector in _RAW:
        seed = bytes.fromhex(vector["seedHex"])
        message = bytes.fromhex(vector["messageHex"])
        public = ed25519.public_key_from_seed(seed)
        signature = ed25519.sign(message, seed)
        assert ed25519.verify(signature, message, public) is True
        # A single flipped bit must fail closed.
        tampered = bytearray(signature)
        tampered[0] ^= 0x01
        assert ed25519.verify(bytes(tampered), message, public) is False
        # Wrong message must fail.
        assert ed25519.verify(signature, message + b"x", public) is False


def test_seed_extraction_from_pkcs8() -> None:
    vector = _RAW[0]
    der = base64.b64decode(vector["privateKeyPkcs8B64"])
    seed = ed25519.seed_from_pkcs8_der(der)
    assert seed.hex() == vector["seedHex"]


def test_seed_extraction_rejects_bad_encoding() -> None:
    for bad in (b"", b"\x00" * 48, b"\x00" * 40):
        try:
            ed25519.seed_from_pkcs8_der(bad)
        except ValueError:
            pass
        else:  # pragma: no cover
            raise AssertionError("expected ValueError")


# ---------------------------------------------------------------------------
# Client behaviour with an injected transport (no real network).
# ---------------------------------------------------------------------------


def _bootstrap() -> client.SessionBootstrap:
    vector = next(v for v in _VECTORS["signatures"] if v["kind"] == "call")
    return client.SessionBootstrap(
        session_id="sess-abc",
        audience="cap-broker.internal.aud",
        broker_endpoint="vpce-123.execute-api.us-east-1.vpce.amazonaws.com",
        broker_api_id="abcapi",
        private_key=vector["privateKeyPkcs8B64"],
        next_sequence=0,
        expires_at="2026-07-13T00:15:00.000Z",
        region="us-east-1",
    )


class _RecordingTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, headers, body):
        self.calls.append((url, headers, json.loads(body.decode("utf-8"))))
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _envelope(result: dict) -> tuple[int, bytes]:
    env = {
        "callId": "call-1",
        "sessionId": "sess-abc",
        "clientRequestId": "req",
        "operation": "twcap:t/s/op@1",
        "result": result,
    }
    return 200, json.dumps(env).encode("utf-8")


def test_client_completed_call_signs_verifiably() -> None:
    transport = _RecordingTransport([_envelope({"status": "completed", "data": {"ok": True}})])
    sdk = client.CapabilityBrokerClient(_bootstrap(), transport=transport)
    result = sdk.call("twcap:t/s/op@1", {"x": 1})
    assert result.status == "completed"
    assert result.data == {"ok": True}
    assert result.call_id == "call-1"

    # The signature the client sent must verify at the broker's public key over the
    # exact canonical signable bytes buildSignableCallPayload would reconstruct.
    _url, headers, wire = transport.calls[0]
    assert wire["kind"] == "call"
    assert headers["Host"] == "abcapi.execute-api.us-east-1.amazonaws.com"
    req = wire["request"]
    payload = {
        "kind": client.BROKER_REQUEST_KIND,
        "audience": "cap-broker.internal.aud",
        "sessionId": req["sessionId"],
        "clientRequestId": req["clientRequestId"],
        "sequence": req["sequence"],
        "nonce": req["nonce"],
        "issuedAt": req["issuedAt"],
        "operation": req["operation"],
        "bodyHash": canonical.sha256_hex(req["input"]),
    }
    signable = canonical.canonicalize(payload).encode("utf-8")
    seed = ed25519.seed_from_pkcs8_der(base64.b64decode(_bootstrap().private_key))
    public = ed25519.public_key_from_seed(seed)
    signature = base64.b64decode(wire["signature"])
    assert ed25519.verify(signature, signable, public) is True


def test_strict_sequence_allocation() -> None:
    transport = _RecordingTransport(
        [
            _envelope({"status": "completed", "data": 1}),
            _envelope({"status": "completed", "data": 2}),
        ]
    )
    sdk = client.CapabilityBrokerClient(_bootstrap(), transport=transport)
    sdk.call("twcap:t/s/op@1", {})
    sdk.call("twcap:t/s/op@1", {})
    assert transport.calls[0][2]["request"]["sequence"] == 0
    assert transport.calls[1][2]["request"]["sequence"] == 1
    assert sdk.next_sequence == 2


def test_lost_response_triggers_signed_status_lookup() -> None:
    from client import _ResponseLost  # noqa: PLC0415

    transport = _RecordingTransport(
        [
            _ResponseLost("connection reset"),
            _envelope({"status": "failed", "error": {"category": "indeterminate", "retryable": False, "message": "recorded failure"}}),
        ]
    )
    sdk = client.CapabilityBrokerClient(_bootstrap(), transport=transport)
    result = sdk.call("twcap:t/s/op@1", {"x": 1})
    # Second wire is a signed STATUS lookup for the original clientRequestId.
    assert transport.calls[1][2]["kind"] == "status"
    assert (
        transport.calls[1][2]["request"]["subjectClientRequestId"]
        == transport.calls[0][2]["request"]["clientRequestId"]
    )
    # Status consumes its own strict sequence (1 after the call's 0).
    assert transport.calls[1][2]["request"]["sequence"] == 1
    assert result.status == "failed"


def test_lost_response_and_lost_status_is_indeterminate() -> None:
    from client import _ResponseLost  # noqa: PLC0415

    transport = _RecordingTransport([_ResponseLost("x"), _ResponseLost("y")])
    sdk = client.CapabilityBrokerClient(_bootstrap(), transport=transport)
    try:
        sdk.call("twcap:t/s/op@1", {})
    except client.BrokerIndeterminateError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected BrokerIndeterminateError")


def test_bootstrap_never_leaks_private_key_in_repr() -> None:
    boot = _bootstrap()
    assert "redacted" in repr(boot)
    assert boot.private_key not in repr(boot)


def test_from_bootstrap_file_rejects_loose_permissions(tmp_path) -> None:
    import os

    path = tmp_path / "bootstrap.json"
    path.write_text(json.dumps({"sessionId": "s"}), encoding="utf-8")
    os.chmod(path, 0o644)
    try:
        client.CapabilityBrokerClient.from_bootstrap_file(str(path))
    except client.BrokerError as exc:
        assert "permission" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected BrokerError for loose permissions")


def test_from_bootstrap_file_reads_0600(tmp_path) -> None:
    import os

    vector = next(v for v in _VECTORS["signatures"] if v["kind"] == "call")
    path = tmp_path / "bootstrap.json"
    boot = {
        "sessionId": "sess-abc",
        "audience": "cap-broker.internal.aud",
        "brokerEndpoint": "vpce-123.execute-api.us-east-1.vpce.amazonaws.com",
        "brokerApiId": "abcapi",
        "privateKey": vector["privateKeyPkcs8B64"],
        "nextSequence": 0,
        "expiresAt": "2026-07-13T00:15:00.000Z",
    }
    path.write_text(json.dumps(boot), encoding="utf-8")
    os.chmod(path, 0o600)
    sdk = client.CapabilityBrokerClient.from_bootstrap_file(str(path))
    assert sdk.session_id == "sess-abc"
