"""Prove native Harness -> Identity OBO -> Gateway exact-user execution."""

from __future__ import annotations

import base64
import json
import os
import time
import uuid

import boto3
import requests
from botocore.eventstream import EventStreamBuffer

REGION = os.environ.get("AWS_REGION", "us-east-1")
ACCOUNT_ID = os.environ["AWS_ACCOUNT_ID"]
ISSUER = os.environ["ASSERTION_ISSUER"].rstrip("/")
KMS_KEY_ARN = os.environ["ASSERTION_KMS_KEY_ARN"]
KID = os.environ["ASSERTION_KID"]
HARNESS_AUDIENCE = os.environ["HARNESS_AUDIENCE"]
GATEWAY_ARN = os.environ["GATEWAY_ARN"]
OAUTH_PROVIDER_ARN = os.environ["OAUTH_PROVIDER_ARN"]
OAUTH_SECRET_ARN = os.environ["OAUTH_SECRET_ARN"]

stamp = str(int(time.time()))[-7:]
harness_name = f"Think316NativeExact{stamp}"
role_name = f"Think316NativeExact{stamp}"
policy_name = "Think316NativeExactUserProof"

kms = boto3.client("kms", region_name=REGION)
iam = boto3.client("iam", region_name=REGION)
control = boto3.client("bedrock-agentcore-control", region_name=REGION)


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_harness_jwt(owner: str) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": HARNESS_AUDIENCE,
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
        "purpose": "harness_invoke",
        "scope": "harness:invoke",
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


def create_role() -> str:
    created = iam.create_role(
        RoleName=role_name,
        Description="Ephemeral THINK-316 native exact-user Harness proof",
        AssumeRolePolicyDocument=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
                        "Action": "sts:AssumeRole",
                    }
                ],
            }
        ),
        Tags=[
            {"Key": "thinkwork:proof", "Value": "THINK-316"},
            {"Key": "thinkwork:ephemeral", "Value": "true"},
        ],
    )
    iam.put_role_policy(
        RoleName=role_name,
        PolicyName=policy_name,
        PolicyDocument=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "BedrockModel",
                        "Effect": "Allow",
                        "Action": [
                            "bedrock:InvokeModel",
                            "bedrock:InvokeModelWithResponseStream",
                        ],
                        "Resource": [
                            "arn:aws:bedrock:*::foundation-model/*",
                            f"arn:aws:bedrock:*:{ACCOUNT_ID}:inference-profile/*",
                        ],
                    },
                    {
                        "Sid": "ExactGateway",
                        "Effect": "Allow",
                        "Action": "bedrock-agentcore:InvokeGateway",
                        "Resource": GATEWAY_ARN,
                    },
                    {
                        "Sid": "IdentityExchange",
                        "Effect": "Allow",
                        "Action": [
                            "bedrock-agentcore:GetResourceOauth2Token",
                            "bedrock-agentcore:GetWorkloadAccessToken",
                            "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                        ],
                        "Resource": [
                            f"arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT_ID}:token-vault/default",
                            OAUTH_PROVIDER_ARN,
                            f"arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT_ID}:workload-identity-directory/default",
                            f"arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT_ID}:workload-identity-directory/default/workload-identity/*",
                        ],
                    },
                    {
                        "Sid": "ExactOauthSecret",
                        "Effect": "Allow",
                        "Action": "secretsmanager:GetSecretValue",
                        "Resource": OAUTH_SECRET_ARN,
                    },
                    {
                        "Sid": "PublicImage",
                        "Effect": "Allow",
                        "Action": [
                            "ecr-public:GetAuthorizationToken",
                            "sts:GetServiceBearerToken",
                        ],
                        "Resource": "*",
                    },
                    {
                        "Sid": "Telemetry",
                        "Effect": "Allow",
                        "Action": [
                            "logs:CreateLogGroup",
                            "logs:CreateLogStream",
                            "logs:DescribeLogGroups",
                            "logs:DescribeLogStreams",
                            "logs:PutLogEvents",
                            "cloudwatch:PutMetricData",
                            "xray:PutTraceSegments",
                            "xray:PutTelemetryRecords",
                            "xray:GetSamplingRules",
                            "xray:GetSamplingTargets",
                        ],
                        "Resource": "*",
                    },
                ],
            }
        ),
    )
    time.sleep(15)
    return created["Role"]["Arn"]


def wait_ready(harness_id: str) -> None:
    deadline = time.time() + 8 * 60
    while time.time() < deadline:
        harness = control.get_harness(harnessId=harness_id)["harness"]
        status = harness["status"]
        if status == "READY":
            return
        if "FAILED" in status:
            raise RuntimeError(f"Harness entered {status}: {harness.get('failureReason')}")
        time.sleep(10)
    raise TimeoutError("Harness did not become READY within eight minutes")


def invoke(harness_arn: str, owner: str, requested_owner: str) -> str:
    token = mint_harness_jwt(owner)
    response = requests.post(
        f"https://bedrock-agentcore.{REGION}.amazonaws.com/harnesses/invoke",
        params={"harnessArn": harness_arn},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": (
                f"think316-native-{owner}-{uuid.uuid4().hex}"
            ),
        },
        json={
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                f"Call owner_probe with requested_owner exactly '{requested_owner}'. "
                                "Report the exact harmlessValue returned. If authorization is denied, "
                                "say DENIED and do not guess a value."
                            )
                        }
                    ],
                }
            ]
        },
        timeout=240,
        stream=True,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Harness invocation returned HTTP {response.status_code}")
    text_parts: list[str] = []
    buffer = EventStreamBuffer()
    buffer.add_data(response.content)
    for message in buffer:
        message_type = message.headers.get(":message-type")
        exception_type = message.headers.get(":exception-type")
        try:
            event = json.loads(message.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if message_type == "exception":
            raise RuntimeError(
                f"Harness stream returned {exception_type or 'exception'}: "
                f"{event.get('message', 'no message')}"
            )
        delta = event.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            text_parts.append(delta["text"])
    return "".join(text_parts)


def delete_harness(harness_id: str) -> None:
    control.delete_harness(harnessId=harness_id)
    deadline = time.time() + 5 * 60
    while time.time() < deadline:
        try:
            control.get_harness(harnessId=harness_id)
        except control.exceptions.ResourceNotFoundException:
            return
        time.sleep(10)
    raise TimeoutError("Harness cleanup did not finish within five minutes")


def main() -> None:
    harness_id: str | None = None
    role_created = False
    try:
        role_arn = create_role()
        role_created = True
        created = control.create_harness(
            harnessName=harness_name,
            executionRoleArn=role_arn,
            authorizerConfiguration={
                "customJWTAuthorizer": {
                    "discoveryUrl": f"{ISSUER}/.well-known/openid-configuration",
                    "allowedAudience": [HARNESS_AUDIENCE],
                    "allowedScopes": ["harness:invoke"],
                }
            },
            model={
                "bedrockModelConfig": {"modelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0"}
            },
            systemPrompt=[
                {
                    "text": (
                        "You are a deterministic identity-boundary proof agent. "
                        "Always use owner_probe exactly once. Never use shell or filesystem tools."
                    )
                }
            ],
            memory={"disabled": {}},
            tools=[
                {
                    "type": "agentcore_gateway",
                    "name": "thinkwork-owner-gateway",
                    "config": {
                        "agentCoreGateway": {
                            "gatewayArn": GATEWAY_ARN,
                            "outboundAuth": {
                                "oauth": {
                                    "providerArn": OAUTH_PROVIDER_ARN,
                                    "scopes": ["gateway:invoke"],
                                    "customParameters": {
                                        "subject_token_type": (
                                            "urn:ietf:params:oauth:token-type:jwt"
                                        )
                                    },
                                    "grantType": "TOKEN_EXCHANGE",
                                }
                            },
                        }
                    },
                }
            ],
        )
        harness = created["harness"]
        harness_id = harness["harnessId"]
        wait_ready(harness_id)

        alice = invoke(harness["arn"], "alice", "alice")
        bob = invoke(harness["arn"], "bob", "bob")
        bob_alice = invoke(harness["arn"], "bob", "alice")
        if "fixture-alice" not in alice:
            raise RuntimeError("Alice Harness turn did not return the Alice fixture")
        if "fixture-bob" not in bob:
            raise RuntimeError("Bob Harness turn did not return the Bob fixture")
        if "fixture-alice" in bob_alice:
            raise RuntimeError("Bob Harness turn returned Alice's fixture")
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "nativeHarnessGateway": True,
                    "inbound": "CUSTOM_JWT",
                    "gatewayCredential": "TOKEN_EXCHANGE",
                    "targetCredential": "TOKEN_EXCHANGE",
                    "aliceToAlice": "allowed",
                    "bobToBob": "allowed",
                    "bobToAlice": "denied",
                    "tokensPrinted": False,
                }
            )
        )
    finally:
        if harness_id:
            delete_harness(harness_id)
        if role_created:
            iam.delete_role_policy(RoleName=role_name, PolicyName=policy_name)
            iam.delete_role(RoleName=role_name)


if __name__ == "__main__":
    main()
