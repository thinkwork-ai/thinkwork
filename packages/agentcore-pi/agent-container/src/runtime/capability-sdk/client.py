"""Capability broker client — the proof-of-possession SDK (THINK-280 U4).

Runs inside an AgentCore Code Interpreter session. It holds a bootstrap written by
the trusted host (reserved path, chmod 0600): the broker endpoint, the session id,
the audience, the session-scoped Ed25519 private key, and the next sequence. With
only that bootstrap the sandbox can invoke *within* the session's bounds but can
never mint or widen one.

Each call:

1. allocates the strict next local sequence and a fresh nonce (serialized per
   session — v1 issues one in-flight request at a time),
2. builds the domain-separated signable payload EXACTLY as
   ``buildSignableCallPayload`` (session.ts): the same ``kind`` tag, the same field
   order, ``bodyHash`` = canonical SHA-256 of the input,
3. signs the canonical bytes with the pure-stdlib Ed25519 signer,
4. POSTs ``{kind, request, signature}`` to the broker over the stdlib
   ``urllib.request``,
5. parses the ``BrokerCallResult`` envelope fail-closed.

On a lost response (an ambiguous network failure *after* the request may have been
delivered) the client NEVER redispatches. It issues a signed status lookup for the
original ``clientRequestId``; the broker returns the recorded outcome without
re-running the operation. If the status lookup is itself lost or rejected, the
outcome is reported as indeterminate for operator reconciliation.

Key material never enters stdout, stderr, exception messages, or ``repr`` output.
"""

from __future__ import annotations

import base64
import json
import os
import stat
import threading
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

try:
    # Materialized as a package (e.g. ``capability_sdk``) by the trusted host.
    from . import canonical, ed25519
except ImportError:  # pragma: no cover - flat layout: files dropped side-by-side.
    import canonical  # type: ignore[no-redef]
    import ed25519  # type: ignore[no-redef]

__all__ = [
    "BROKER_REQUEST_KIND",
    "BROKER_STATUS_KIND",
    "BrokerError",
    "BrokerIndeterminateError",
    "BrokerProtocolError",
    "BrokerResult",
    "CapabilityBrokerClient",
    "SessionBootstrap",
]

BROKER_REQUEST_KIND = "twcap-broker-request"
BROKER_STATUS_KIND = "twcap-broker-status"

BROKER_ERROR_CATEGORIES = frozenset(
    {
        "invalid_request",
        "unauthorized",
        "replay_rejected",
        "session_expired",
        "session_cancelled",
        "policy_blocked",
        "approval_required",
        "readiness_blocked",
        "budget_exhausted",
        "unavailable_adapter",
        "adapter_error",
        "provider_error",
        "rate_limited",
        "timeout",
        "cancelled",
        "indeterminate",
    }
)

# Transport: (url, headers, body_bytes) -> (status_code, response_bytes).
# A network failure (delivery ambiguous) must raise; an HTTP response — even a 4xx —
# must return, so the caller can distinguish a lost response from a broker reply.
Transport = Callable[[str, dict[str, str], bytes], "tuple[int, bytes]"]


class BrokerError(Exception):
    """Base class for broker client failures. Never carries key material."""


class BrokerProtocolError(BrokerError):
    """The broker's transport response was malformed or an unexpected HTTP status."""


class BrokerIndeterminateError(BrokerError):
    """A response was lost and the signed status lookup could not resolve it.

    The call may or may not have taken effect; it must not be blindly retried.
    """


@dataclass(frozen=True)
class SessionBootstrap:
    """Mirror of the TypeScript ``SessionBootstrap`` (session.ts), plus the transport
    coordinates a private-REST-API-via-VPCE call needs when private DNS is disabled
    (THINK-144). ``private_key`` is base64 PKCS#8 DER, exactly what
    ``generateEphemeralKeypair`` emits."""

    session_id: str
    audience: str
    broker_endpoint: str
    broker_api_id: str
    private_key: str
    next_sequence: int
    expires_at: str
    region: str = "us-east-1"
    invoke_path: str = "/"
    host_header: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> SessionBootstrap:
        try:
            return cls(
                session_id=str(raw["sessionId"]),
                audience=str(raw["audience"]),
                broker_endpoint=str(raw["brokerEndpoint"]),
                broker_api_id=str(raw["brokerApiId"]),
                private_key=str(raw["privateKey"]),
                next_sequence=int(raw["nextSequence"]),
                expires_at=str(raw["expiresAt"]),
                region=str(raw.get("region", "us-east-1")),
                invoke_path=str(raw.get("invokePath", "/")),
                host_header=(str(raw["hostHeader"]) if raw.get("hostHeader") else None),
            )
        except (KeyError, ValueError, TypeError) as exc:
            # Never echo the raw bootstrap (it holds the private key).
            raise BrokerError("malformed session bootstrap") from exc

    def __repr__(self) -> str:  # pragma: no cover - defensive; excludes private_key
        return (
            f"SessionBootstrap(session_id={self.session_id!r}, "
            f"audience={self.audience!r}, broker_endpoint={self.broker_endpoint!r}, "
            "private_key=<redacted>)"
        )


@dataclass
class BrokerResult:
    """Parsed ``BrokerCallResult`` envelope (envelope.ts), fail-closed."""

    status: str
    call_id: str = ""
    data: Any = None
    durable_ref: dict[str, Any] | None = None
    poll_token: str | None = None
    cancellable: bool | None = None
    error: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "completed"


def _default_transport(url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        # An HTTP error status is still a delivered response — read and return it.
        return exc.code, exc.read()
    except urllib.error.URLError as exc:
        # Connection-level failure: delivery is ambiguous.
        raise _ResponseLost(str(exc.reason)) from None
    except OSError as exc:
        raise _ResponseLost(exc.strerror or "connection error") from None


class _ResponseLost(Exception):
    """Internal: the response was not received; delivery is ambiguous."""


class CapabilityBrokerClient:
    """Serialized (v1) proof-of-possession client for one broker session."""

    def __init__(
        self,
        bootstrap: SessionBootstrap,
        *,
        transport: Transport | None = None,
        now: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
        nonce_factory: Callable[[], str] | None = None,
    ) -> None:
        # Extract the raw seed once and keep ONLY the seed; never retain the base64
        # private key on the instance and never expose the seed.
        try:
            der = base64.b64decode(bootstrap.private_key, validate=True)
            self.__seed = ed25519.seed_from_pkcs8_der(der)
        except Exception:  # noqa: BLE001 - normalize any decode/parse failure
            raise BrokerError("invalid session private key") from None
        self._session_id = bootstrap.session_id
        self._audience = bootstrap.audience
        self._endpoint = bootstrap.broker_endpoint
        self._api_id = bootstrap.broker_api_id
        self._region = bootstrap.region
        self._invoke_path = bootstrap.invoke_path
        self._host_header = (
            bootstrap.host_header
            or f"{bootstrap.broker_api_id}.execute-api.{bootstrap.region}.amazonaws.com"
        )
        self._next_sequence = int(bootstrap.next_sequence)
        self._transport = transport or _default_transport
        self._now = now or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid.uuid4()))
        self._nonce_factory = nonce_factory or (lambda: uuid.uuid4().hex)
        self._lock = threading.Lock()

    # -- construction -------------------------------------------------------

    @classmethod
    def from_bootstrap_file(cls, path: str, **kwargs: Any) -> CapabilityBrokerClient:
        """Load a bootstrap JSON from a reserved 0600 path.

        Refuses to read a bootstrap that is group- or world-accessible — the private
        key must not be exposed by a loose mode.
        """
        try:
            info = os.stat(path)
        except OSError:
            raise BrokerError("session bootstrap unavailable") from None
        if info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise BrokerError("session bootstrap has insecure permissions (expected 0600)")
        try:
            with open(path, encoding="utf-8") as handle:
                raw = json.load(handle)
        except (OSError, ValueError):
            raise BrokerError("session bootstrap unreadable") from None
        if not isinstance(raw, dict):
            raise BrokerError("session bootstrap is not an object")
        return cls(SessionBootstrap.from_dict(raw), **kwargs)

    # -- public surface -----------------------------------------------------

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def next_sequence(self) -> int:
        return self._next_sequence

    def call(self, operation: str, input: Any) -> BrokerResult:
        """Invoke a ``twcap:`` operation. Serialized per session (v1)."""
        with self._lock:
            sequence = self._allocate_sequence()
            client_request_id = self._id_factory()
            request = {
                "sessionId": self._session_id,
                "clientRequestId": client_request_id,
                "sequence": sequence,
                "nonce": self._nonce_factory(),
                "issuedAt": self._issued_at(),
                "operation": operation,
                "input": input,
            }
            signature = self._sign_call(request)
            wire = {"kind": "call", "request": request, "signature": signature}
            try:
                return self._send(wire)
            except _ResponseLost:
                # The call may have been recorded — never redispatch; ask the broker.
                return self._recover(client_request_id)

    # -- internals ----------------------------------------------------------

    def _allocate_sequence(self) -> int:
        sequence = self._next_sequence
        self._next_sequence += 1
        return sequence

    def _issued_at(self) -> str:
        # RFC 3339 UTC with milliseconds and a "Z" suffix — matches Date#toISOString.
        moment = self._now().astimezone(UTC)
        return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"

    def _sign_call(self, request: dict[str, Any]) -> str:
        payload = {
            "kind": BROKER_REQUEST_KIND,
            "audience": self._audience,
            "sessionId": request["sessionId"],
            "clientRequestId": request["clientRequestId"],
            "sequence": request["sequence"],
            "nonce": request["nonce"],
            "issuedAt": request["issuedAt"],
            "operation": request["operation"],
            "bodyHash": canonical.sha256_hex(request["input"]),
        }
        return self._sign(canonical.canonicalize(payload))

    def _sign_status(self, request: dict[str, Any]) -> str:
        payload = {
            "kind": BROKER_STATUS_KIND,
            "audience": self._audience,
            "sessionId": request["sessionId"],
            "clientRequestId": request["clientRequestId"],
            "subjectClientRequestId": request["subjectClientRequestId"],
            "sequence": request["sequence"],
            "nonce": request["nonce"],
            "issuedAt": request["issuedAt"],
        }
        return self._sign(canonical.canonicalize(payload))

    def _sign(self, signable: str) -> str:
        signature = ed25519.sign(signable.encode("utf-8"), self.__seed)
        return base64.b64encode(signature).decode("ascii")

    def _recover(self, subject_client_request_id: str) -> BrokerResult:
        sequence = self._allocate_sequence()
        request = {
            "sessionId": self._session_id,
            "clientRequestId": self._id_factory(),
            "subjectClientRequestId": subject_client_request_id,
            "sequence": sequence,
            "nonce": self._nonce_factory(),
            "issuedAt": self._issued_at(),
        }
        signature = self._sign_status(request)
        wire = {"kind": "status", "request": request, "signature": signature}
        try:
            return self._send(wire)
        except _ResponseLost:
            raise BrokerIndeterminateError(
                "broker call outcome is indeterminate: response lost and status "
                "lookup could not be delivered"
            ) from None

    def _url(self) -> str:
        endpoint = self._endpoint.rstrip("/")
        path = self._invoke_path if self._invoke_path.startswith("/") else "/" + self._invoke_path
        if "://" in endpoint:
            return endpoint + path
        return f"https://{endpoint}{path}"

    def _send(self, wire: dict[str, Any]) -> BrokerResult:
        body = json.dumps(wire, separators=(",", ":")).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Host": self._host_header,
        }
        status, response = self._transport(self._url(), headers, body)
        if status == 400 or status == 405:
            raise BrokerProtocolError(f"broker rejected transport (HTTP {status})")
        if status >= 500:
            # Server-side failure with a delivered status line — treat as lost so the
            # caller does not misread a 5xx body as a broker result.
            raise _ResponseLost(f"HTTP {status}")
        if status != 200:
            raise BrokerProtocolError(f"unexpected broker HTTP status {status}")
        try:
            envelope = json.loads(response.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise BrokerProtocolError("broker response was not valid JSON") from None
        return _parse_envelope(envelope)


def _require_str(value: Any, message: str) -> str:
    if not isinstance(value, str) or not value:
        raise BrokerProtocolError(message)
    return value


def _parse_envelope(envelope: Any) -> BrokerResult:
    """Fail-closed parse of a ``BrokerCallEnvelope`` -> ``BrokerResult``."""
    if not isinstance(envelope, dict):
        raise BrokerProtocolError("broker envelope: not an object")
    result = envelope.get("result")
    if not isinstance(result, dict):
        raise BrokerProtocolError("broker envelope: missing result")
    call_id = envelope.get("callId", "")
    status = result.get("status")
    if status == "completed":
        data = result.get("data")
        durable = result.get("durableRef")
        if data is not None and durable is not None:
            raise BrokerProtocolError("completed: data and durableRef are exclusive")
        if durable is not None:
            if not isinstance(durable, dict) or durable.get("kind") not in ("artifact", "s3"):
                raise BrokerProtocolError("completed: invalid durableRef")
            _require_str(durable.get("ref"), "completed: invalid durableRef")
        return BrokerResult(
            status="completed",
            call_id=str(call_id),
            data=data,
            durable_ref=durable,
            raw=result,
        )
    if status == "accepted":
        poll_token = _require_str(result.get("pollToken"), "accepted: pollToken required")
        cancellable = result.get("cancellable")
        if not isinstance(cancellable, bool):
            raise BrokerProtocolError("accepted: cancellable required")
        return BrokerResult(
            status="accepted",
            call_id=str(call_id),
            poll_token=poll_token,
            cancellable=cancellable,
            raw=result,
        )
    if status == "failed":
        error = result.get("error")
        if (
            not isinstance(error, dict)
            or error.get("category") not in BROKER_ERROR_CATEGORIES
            or not isinstance(error.get("retryable"), bool)
            or not isinstance(error.get("message"), str)
        ):
            raise BrokerProtocolError("failed: invalid error")
        return BrokerResult(status="failed", call_id=str(call_id), error=error, raw=result)
    raise BrokerProtocolError("broker envelope: unknown result status")
