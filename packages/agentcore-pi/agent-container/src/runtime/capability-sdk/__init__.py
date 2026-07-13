"""Pure-stdlib capability-broker SDK (THINK-280 U4).

The trusted host materializes these modules into an AgentCore Code Interpreter
session so an agent can invoke bounded capabilities through the broker with
proof-of-possession — no third-party packages, since the default interpreter image
has no pip and no network egress.

Public surface:

* :mod:`canonical` — RFC 8785 canonicalization byte-identical to the Node
  ``@thinkwork/capability-contracts`` canonicalizer.
* :mod:`ed25519` — pure-stdlib Ed25519 signing (RFC 8032).
* :class:`CapabilityBrokerClient` — the signing client.
"""

from __future__ import annotations

try:
    # Materialized as a valid package (e.g. ``capability_sdk``) by the trusted host.
    from . import canonical, ed25519
    from .canonical import CanonicalizationError, canonicalize, sha256_hex
    from .client import (
        BROKER_REQUEST_KIND,
        BROKER_STATUS_KIND,
        BrokerError,
        BrokerIndeterminateError,
        BrokerProtocolError,
        BrokerResult,
        CapabilityBrokerClient,
        SessionBootstrap,
    )
except ImportError:  # pragma: no cover - flat layout (repo dir name is not importable)
    import canonical  # type: ignore[no-redef]
    import ed25519  # type: ignore[no-redef]
    from canonical import CanonicalizationError, canonicalize, sha256_hex  # type: ignore[no-redef]
    from client import (  # type: ignore[no-redef]
        BROKER_REQUEST_KIND,
        BROKER_STATUS_KIND,
        BrokerError,
        BrokerIndeterminateError,
        BrokerProtocolError,
        BrokerResult,
        CapabilityBrokerClient,
        SessionBootstrap,
    )

__all__ = [
    "BROKER_REQUEST_KIND",
    "BROKER_STATUS_KIND",
    "BrokerError",
    "BrokerIndeterminateError",
    "BrokerProtocolError",
    "BrokerResult",
    "CanonicalizationError",
    "CapabilityBrokerClient",
    "SessionBootstrap",
    "canonical",
    "canonicalize",
    "ed25519",
    "sha256_hex",
]
