"""Run AWS's official CUSTOM_JWT Harness + OAuth Gateway sample unchanged.

The AWS sample source directory must be supplied in AGENTCORE_SAMPLE_DIR. The
driver generates an ephemeral Cognito user/password, never prints credentials
or tokens, and delegates teardown to the sample's cleanup_all helper.
"""

from __future__ import annotations

import json
import os
import secrets
import string
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

import boto3
import requests
from botocore.eventstream import EventStreamBuffer

REGION = os.environ.get("AWS_REGION", "us-east-1")
SAMPLE_DIR = Path(os.environ["AGENTCORE_SAMPLE_DIR"]).resolve()
if not (SAMPLE_DIR / "utils" / "setup_helpers.py").is_file():
    raise RuntimeError("AGENTCORE_SAMPLE_DIR does not contain the official OAuth sample helpers")

sys.path.insert(0, str(SAMPLE_DIR))
os.chdir(SAMPLE_DIR)

from utils.setup_helpers import (  # noqa: E402
    cleanup_all,
    create_credential_provider,
    create_gateway_with_lambda_target,
    create_harness_execution_role,
    create_m2m_pool,
    create_user_auth_pool,
    deploy_lambda,
)


def random_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#%"
    return "Aa1!" + "".join(secrets.choice(alphabet) for _ in range(20))


def extract_text(raw: bytes) -> tuple[str, list[str]]:
    """Decode the AWS event-stream instead of regex-scanning nested JSON."""
    text: list[str] = []
    event_types: list[str] = []
    buffer = EventStreamBuffer()
    buffer.add_data(raw)
    for message in buffer:
        message_type = message.headers.get(":message-type")
        event_type = message.headers.get(":event-type")
        exception_type = message.headers.get(":exception-type")
        event_types.append(
            ":".join(str(value) for value in (message_type, event_type or exception_type) if value)
        )
        try:
            event = json.loads(message.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if message_type == "exception":
            raise RuntimeError(
                "Harness event stream returned "
                f"{exception_type or 'exception'}: {event.get('message', 'no message')}"
            )
        for error_key in (
            "runtimeClientError",
            "internalServerException",
            "validationException",
        ):
            if error_key in event:
                raise RuntimeError(f"Harness stream returned {error_key}: {event[error_key]}")
        delta = event.get("delta", {})
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            text.append(delta["text"])
    return "".join(text), event_types


def wait_for_harness(control, harness_id: str) -> None:
    deadline = time.time() + 8 * 60
    while time.time() < deadline:
        harness = control.get_harness(harnessId=harness_id)["harness"]
        status = harness["status"]
        if status == "READY":
            return
        if "FAILED" in status:
            raise RuntimeError(
                f"Harness entered {status}: {harness.get('failureReason', 'unknown')}"
            )
        time.sleep(10)
    raise TimeoutError("Harness did not become READY within eight minutes")


def main() -> None:
    stamp = str(int(time.time()))[-7:]
    prefix = f"tw316oauth{stamp}"
    username = f"alice-{stamp}@example.com"
    password = random_password()
    account_id = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
    control = boto3.client("bedrock-agentcore-control", region_name=REGION)
    cognito = boto3.client("cognito-idp", region_name=REGION)

    try:
        pool1 = create_user_auth_pool(REGION, prefix, username, password)
        pool2 = create_m2m_pool(REGION, prefix)
        credential = create_credential_provider(
            REGION,
            prefix,
            discovery_url=pool2["discovery_url"],
            client_id=pool2["client_id"],
            client_secret=pool2["client_secret"],
        )
        target_lambda = deploy_lambda(REGION, prefix)
        gateway = create_gateway_with_lambda_target(
            REGION,
            prefix,
            account_id,
            discovery_url=pool2["discovery_url"],
            allowed_client=pool2["client_id"],
            allowed_scope=pool2["scope"],
            lambda_arn=target_lambda["function_arn"],
            lambda_function_name=target_lambda["function_name"],
        )
        harness_role = create_harness_execution_role(REGION, prefix, account_id)

        harness_name = f"{prefix}_harness"
        created = control.create_harness(
            harnessName=harness_name,
            executionRoleArn=harness_role["role_arn"],
            authorizerConfiguration={
                "customJWTAuthorizer": {
                    "discoveryUrl": pool1["discovery_url"],
                    "allowedClients": [pool1["client_id"]],
                }
            },
            model={
                "bedrockModelConfig": {"modelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0"}
            },
            systemPrompt=[
                {
                    "text": (
                        "You are an order management assistant. "
                        "Use the gateway tools to look up and update orders. "
                        "Always confirm the order details before making changes."
                    )
                }
            ],
            # The official sample role omits permissions for the Harness's
            # auto-created memory. Disable memory here so this control isolates
            # the Identity -> Gateway OAuth path instead of failing ListEvents.
            memory={"disabled": {}},
            tools=[
                {
                    "type": "agentcore_gateway",
                    "name": "order-gateway",
                    "config": {
                        "agentCoreGateway": {
                            "gatewayArn": gateway["gateway_arn"],
                            "outboundAuth": {
                                "oauth": {
                                    "providerArn": credential["arn"],
                                    "scopes": [pool2["scope"]],
                                    "grantType": "CLIENT_CREDENTIALS",
                                }
                            },
                        }
                    },
                }
            ],
        )
        harness = created["harness"]
        harness_id = harness["harnessId"]
        harness_arn = harness["arn"]
        wait_for_harness(control, harness_id)

        authentication = cognito.initiate_auth(
            ClientId=pool1["client_id"],
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": username, "PASSWORD": password},
        )
        bearer_token = authentication["AuthenticationResult"]["AccessToken"]

        escaped_arn = urllib.parse.quote(harness_arn, safe="")
        url = (
            f"https://bedrock-agentcore.{REGION}.amazonaws.com/harnesses/invoke"
            f"?harnessArn={escaped_arn}"
        )
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "Content-Type": "application/json",
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": (
                    f"official-oauth-{uuid.uuid4().hex}"
                ),
            },
            json={
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "text": (
                                    "Look up order ORD-001 and tell me its status. "
                                    "Use the gateway tool."
                                )
                            }
                        ],
                    }
                ]
            },
            timeout=180,
            stream=True,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Official Harness invocation returned HTTP {response.status_code}: "
                f"{response.text[:500]}"
            )

        text, event_types = extract_text(response.content)
        if "ORD-001" not in text or "shipped" not in text.lower():
            diagnostics = {
                "contentType": response.headers.get("content-type"),
                "contentLength": len(response.content),
                "transferEncoding": response.headers.get("transfer-encoding"),
                "requestIdPresent": bool(response.headers.get("x-amzn-requestid")),
            }
            raise RuntimeError(
                "Official Harness invocation did not return the expected safe order fixture "
                f"(diagnostics={diagnostics}, eventTypes={event_types}, "
                f"response excerpt={text[:500]!r})"
            )

        print(
            json.dumps(
                {
                    "result": "PASS",
                    "sample": "official-custom-jwt-harness-oauth-gateway",
                    "harnessInbound": "CUSTOM_JWT",
                    "gatewayOutbound": "OAUTH_CLIENT_CREDENTIALS",
                    "gatewayTarget": "LAMBDA",
                    "expectedOrder": "ORD-001",
                    "expectedStatus": "shipped",
                    "tokensPrinted": False,
                }
            )
        )
    finally:
        cleanup_all(REGION, prefix)


if __name__ == "__main__":
    main()
