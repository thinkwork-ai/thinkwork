"""SessionBootstrap operations map + friendly-operationId resolution (THINK-280).

A Routine calls ``client.call("issues.list", …)`` with a friendly operationId;
the SDK expands it to the exact pinned ``twcap://`` reference the broker parses
and authorizes. These tests assert the bootstrap parses the ``operations`` map
and that resolution expands bound ids, passes twcap references through verbatim,
and leaves unbound ids untouched (so the broker fails them closed).
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _loader import load_sdk  # noqa: E402

canonical, ed25519, client = load_sdk()

_CANONICAL_TWCAP = (
    "twcap://sleek-squirrel-230/connection/github-rest-public"
    "/versions/1/operations/issues.list"
    "?contract=sha256:7a4e8d11ce339e1819984e8c85a39580a59ee45bcd7726cda534bc37456dd1af"
)


def _bootstrap(operations: dict[str, str] | None) -> dict:
    raw = {
        "sessionId": "sess-1",
        "audience": "broker-aud",
        "brokerEndpoint": "vpce-1234.execute-api.us-east-1.vpce.amazonaws.com",
        "brokerApiId": "abc123",
        "privateKey": "",
        "nextSequence": 0,
        "expiresAt": "2026-07-14T00:15:00Z",
    }
    if operations is not None:
        raw["operations"] = operations
    return raw


def _client_with(operations: dict[str, str] | None):
    boot = client.SessionBootstrap.from_dict(_bootstrap(operations))
    # A blank private key would fail seed decode in the real constructor; build
    # the instance without __init__ and set only the fields _resolve_operation
    # reads. That keeps this a focused unit of the resolution logic.
    inst = object.__new__(client.CapabilityBrokerClient)
    inst._operations = dict(boot.operations)
    return inst


def test_from_dict_parses_operations_map() -> None:
    boot = client.SessionBootstrap.from_dict(
        _bootstrap({"issues.list": _CANONICAL_TWCAP})
    )
    assert boot.operations == {"issues.list": _CANONICAL_TWCAP}


def test_from_dict_defaults_operations_to_empty() -> None:
    boot = client.SessionBootstrap.from_dict(_bootstrap(None))
    assert boot.operations == {}


def test_resolve_expands_bound_operation_id() -> None:
    inst = _client_with({"issues.list": _CANONICAL_TWCAP})
    assert inst._resolve_operation("issues.list") == _CANONICAL_TWCAP


def test_resolve_passes_twcap_reference_through() -> None:
    inst = _client_with({"issues.list": "twcap://other/…"})
    # An explicit twcap: reference is never remapped, even if a key collides.
    assert inst._resolve_operation(_CANONICAL_TWCAP) == _CANONICAL_TWCAP


def test_resolve_leaves_unbound_id_untouched() -> None:
    inst = _client_with({"issues.list": _CANONICAL_TWCAP})
    # Unbound id is passed through so the broker fails it closed rather than the
    # SDK guessing a reference.
    assert inst._resolve_operation("repos.get") == "repos.get"
