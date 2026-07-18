"""Prove exact-user AgentCore Identity OBO ownership through Gateway.

The script mints short-lived proof JWTs with the Terraform-managed KMS key and
exercises the Gateway's downstream token exchange plus Cedar owner isolation.
Tokens and secrets are never printed.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import uuid
from typing import Any

import boto3
import requests

REGION = os.environ.get("AWS_REGION", "us-east-1")
ISSUER = os.environ["ASSERTION_ISSUER"].rstrip("/")
KMS_KEY_ARN = os.environ["ASSERTION_KMS_KEY_ARN"]
KID = os.environ["ASSERTION_KID"]
GATEWAY_AUDIENCE = os.environ["GATEWAY_AUDIENCE"]
GATEWAY_URL = os.environ["GATEWAY_URL"]
GATEWAY_ARN = os.environ["GATEWAY_ARN"]
TARGET_NAME = os.environ["GATEWAY_TARGET_NAME"]
API_ENDPOINT = os.environ["API_ENDPOINT"].rstrip("/")
PROOF_OWNERS = tuple(
    owner.strip().lower()
    for owner in os.environ.get("PROOF_OWNER_IDS", "alice,bob").split(",")
    if owner.strip()
)
if len(PROOF_OWNERS) != 2 or len(set(PROOF_OWNERS)) != 2:
    raise RuntimeError("PROOF_OWNER_IDS must contain exactly two distinct owners")

kms = boto3.client("kms", region_name=REGION)


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_gateway_jwt(
    owner: str, requested_owner: str, operation: str = "owner_probe"
) -> str:
    now = int(time.time())
    arguments = {"requested_owner": requested_owner}
    input_hash = hashlib.sha256(
        json.dumps(arguments, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()
    claims = {
        "iss": ISSUER,
        "aud": GATEWAY_AUDIENCE,
        "sub": owner,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + 300,
        "tenant_id": "tenant-proof",
        "space_id": "space-proof",
        "agent_id": "agent-proof",
        "thread_id": "thread-proof",
        "turn_id": f"turn-{owner}-{uuid.uuid4().hex[:8]}",
        "participant_id": owner,
        "session_generation": 1,
        "purpose": "gateway_operation",
        "scope": "gateway:invoke",
        "token_class": "agentcore_proof_obo",
        "operation": operation,
        "tool_use_id": f"tool-{uuid.uuid4().hex[:8]}",
        "input_hash": input_hash,
    }
    header = {"alg": "RS256", "kid": KID, "typ": "JWT"}
    signing_input = ".".join(
        b64url(json.dumps(value, separators=(",", ":")).encode()) for value in (header, claims)
    )
    signed = kms.sign(
        KeyId=KMS_KEY_ARN,
        Message=signing_input.encode(),
        MessageType="RAW",
        SigningAlgorithm="RSASSA_PKCS1_V1_5_SHA_256",
    )
    return f"{signing_input}.{b64url(signed['Signature'])}"


def initialize_gateway(jwt: str) -> str:
    headers = gateway_headers(jwt)
    response = requests.post(
        GATEWAY_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {"elicitation": {"url": {}}},
                "clientInfo": {"name": "think316-proof", "version": "1.0"},
            },
        },
        timeout=60,
    )
    response.raise_for_status()
    session_id = response.headers.get("mcp-session-id")
    if not session_id:
        raise RuntimeError("Gateway initialize returned no MCP session id")
    initialized_headers = {**headers, "Mcp-Session-Id": session_id}
    initialized = requests.post(
        GATEWAY_URL,
        headers=initialized_headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        timeout=30,
    )
    if initialized.status_code not in {200, 202, 204}:
        raise RuntimeError(
            f"Gateway initialized notification returned HTTP {initialized.status_code}"
        )
    return session_id


def gateway_headers(jwt: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
    }


def call_gateway(
    jwt: str,
    requested_owner: str,
    session_id: str | None = None,
    operation: str = "owner_probe",
) -> tuple[int, dict[str, Any]]:
    active_session = session_id or initialize_gateway(jwt)
    response = requests.post(
        GATEWAY_URL,
        headers={**gateway_headers(jwt), "Mcp-Session-Id": active_session},
        json={
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": f"{TARGET_NAME}___{operation}",
                "arguments": {"requested_owner": requested_owner},
            },
        },
        timeout=90,
    )
    body = decode_gateway_body(response)
    return response.status_code, body


def decode_gateway_body(response: requests.Response) -> dict[str, Any]:
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            value = response.json()
        except requests.JSONDecodeError as error:
            raise RuntimeError(
                f"Gateway returned invalid JSON HTTP {response.status_code}"
            ) from error
        if isinstance(value, dict):
            return value
    if "text/event-stream" in content_type:
        for line in response.text.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                value = json.loads(line.removeprefix("data:").strip())
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
    raise RuntimeError(
        "Gateway returned an unsupported response "
        f"(HTTP {response.status_code}, contentType={content_type!r}, "
        f"bytes={len(response.content)})"
    )


def projected_owner(body: dict[str, Any]) -> str | None:
    serialized = json.dumps(body)
    if (
        "private_note" in serialized
        or "privateNote" in serialized
        or "SECRET_SENTINEL" in serialized
    ):
        raise RuntimeError("private target data crossed the disclosure boundary")

    def find(value: Any, depth: int = 0) -> str | None:
        if depth > 8:
            return None
        if isinstance(value, dict):
            owner = value.get("owner_alias") or value.get("ownerAlias")
            if isinstance(owner, str):
                return owner
            for nested in value.values():
                found = find(nested, depth + 1)
                if found:
                    return found
        elif isinstance(value, list):
            for nested in value:
                found = find(nested, depth + 1)
                if found:
                    return found
        elif isinstance(value, str) and value[:1] in {"{", "["}:
            try:
                return find(json.loads(value), depth + 1)
            except json.JSONDecodeError:
                return None
        return None

    return find(body)


def mixed_projection(body: dict[str, Any]) -> dict[str, Any] | None:
    serialized = json.dumps(body)
    if (
        "private_note" in serialized
        or "privateNote" in serialized
        or "SECRET_SENTINEL" in serialized
    ):
        raise RuntimeError("private target data crossed the mixed disclosure boundary")

    def find(value: Any, depth: int = 0) -> dict[str, Any] | None:
        if depth > 8:
            return None
        if isinstance(value, dict):
            disclosure = value.get("disclosure")
            task_field = value.get("taskField") or value.get("task_field")
            if isinstance(disclosure, dict) and isinstance(task_field, str):
                return {
                    "taskField": task_field,
                    "decisionStatus": disclosure.get("status"),
                    "reasonCode": disclosure.get("reasonCode")
                    or disclosure.get("reason_code"),
                    "hasDecisionId": isinstance(disclosure.get("decisionId"), str)
                    or isinstance(disclosure.get("decision_id"), str),
                }
            for nested in value.values():
                found = find(nested, depth + 1)
                if found:
                    return found
        elif isinstance(value, list):
            for nested in value:
                found = find(nested, depth + 1)
                if found:
                    return found
        elif isinstance(value, str) and value[:1] in {"{", "["}:
            try:
                return find(json.loads(value), depth + 1)
            except json.JSONDecodeError:
                return None
        return None

    return find(body)


def main() -> None:
    alice, bob = PROOF_OWNERS
    tokens = {owner: mint_gateway_jwt(owner, owner) for owner in PROOF_OWNERS}

    alice_status, alice_body = call_gateway(tokens[alice], alice)
    bob_status, bob_body = call_gateway(tokens[bob], bob)
    bob_alice_status, bob_alice_body = call_gateway(tokens[bob], alice)

    alice_mixed_token = mint_gateway_jwt(alice, alice, "mixed_disclosure")
    bob_mixed_token = mint_gateway_jwt(bob, bob, "mixed_disclosure")
    alice_mixed_status, alice_mixed_body = call_gateway(
        alice_mixed_token, alice, operation="mixed_disclosure"
    )
    bob_mixed_status, bob_mixed_body = call_gateway(
        bob_mixed_token, bob, operation="mixed_disclosure"
    )

    if alice_status != 200 or projected_owner(alice_body) != alice:
        raise RuntimeError("Alice did not receive only the Alice projection")
    if bob_status != 200 or projected_owner(bob_body) != bob:
        raise RuntimeError("Bob did not receive only the Bob projection")
    if bob_alice_status == 200 and projected_owner(bob_alice_body) == alice:
        raise RuntimeError("Bob was able to retrieve Alice's projection")
    alice_mixed = mixed_projection(alice_mixed_body)
    if (
        alice_mixed_status != 200
        or not alice_mixed
        or alice_mixed["taskField"] != f"approved-summary-{alice}"
        or alice_mixed["decisionStatus"] != "confirmation_required"
        or alice_mixed["reasonCode"] != "unrelated_sensitive_fields_withheld"
        or not alice_mixed["hasDecisionId"]
    ):
        raise RuntimeError("Alice mixed disclosure was not safely projected")
    if bob_mixed_status == 200 and mixed_projection(bob_mixed_body):
        raise RuntimeError("Bob was able to invoke the Alice-only mixed disclosure")

    direct = requests.get(
        f"{API_ENDPOINT}/agentcore-proof/target/owner",
        params={"requested_owner": alice},
        timeout=30,
    )
    if direct.status_code != 401:
        raise RuntimeError("Direct target request was not rejected")

    print(
        json.dumps(
            {
                "result": "PASS",
                "aliceToAlice": "allowed",
                "bobToBob": "allowed",
                "bobToAlice": "denied",
                "directTarget": "denied",
                "aliceMixed": "allowed_sanitized",
                "bobMixed": "denied",
                "withholdingDecision": "confirmation_required",
                "credentialOwners": ["alice-fixture", "bob-fixture"],
                "tokensPrinted": False,
                "privateSentinelsObserved": False,
            }
        )
    )


if __name__ == "__main__":
    main()
