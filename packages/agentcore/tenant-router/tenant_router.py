"""
Gateway Tenant Router — bridges ServerlessClaw Gateway and AgentCore Runtime.

Runs as an HTTP proxy alongside the ServerlessClaw Gateway process.
The gateway webhook forwards incoming messages here; this module:
  1. Derives a tenant_id from the channel + user identity
  2. Invokes AgentCore Runtime with sessionId=tenant_id
  3. Returns the agent response to the gateway for delivery

Design decisions:
  - tenant_id format: {channel}__{user_id} (e.g. "wa__8613800138000")
  - Stateless: all state lives in AgentCore Runtime sessions and SSM
  - Graceful fallback: if AgentCore is unreachable, returns error (no local fallback)
"""

import hashlib
import hmac
import json
import logging
import os
import re
import time

from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

# --- THINKWORK_ADDITION: Convex message persistence ---
import urllib.request
import urllib.error

CONVEX_URL = os.environ.get("CONVEX_URL", "")
CONVEX_API_TOKEN = os.environ.get("CONVEX_API_TOKEN", "")


def convex_send_message(endpoint: str, payload: dict) -> None:
    """POST a message to a Convex HTTP endpoint. Fire-and-forget."""
    if not CONVEX_URL:
        return
    site_url = CONVEX_URL.replace(".convex.cloud", ".convex.site")
    url = f"{site_url}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CONVEX_API_TOKEN}",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        logger.warning("Convex write failed endpoint=%s error=%s", endpoint, e)
# --- END THINKWORK_ADDITION ---

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

STACK_NAME = os.environ.get("STACK_NAME", "dev")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
RUNTIME_IDS = {}  # {"claude": "abc123", "code": "def456"}
RUNTIME_ARNS = {}  # {"claude": "arn:...", "code": "arn:..."}
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "8090"))
FLEET_API_SECRET = os.environ.get("FLEET_API_SECRET", "")

# Tenant ID validation: alphanumeric, underscores, hyphens, dots
_TENANT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.\-]{1,128}$")

# Channel name normalization
_CHANNEL_ALIASES = {
    "whatsapp": "wa",
    "telegram": "tg",
    "discord": "dc",
    "slack": "sl",
    "teams": "ms",
    "imessage": "im",
    "googlechat": "gc",
    "webchat": "web",
}


# ---------------------------------------------------------------------------
# Tenant ID derivation
# ---------------------------------------------------------------------------

def derive_tenant_id(channel: str, user_id: str) -> str:
    """Derive a stable, safe tenant_id from channel and user identity.

    Format: {channel_short}__{sanitized_user_id}
    Examples:
      - ("whatsapp", "8613800138000") → "wa__8613800138000"
      - ("telegram", "123456789")     → "tg__123456789"
      - ("discord", "user#1234")      → "dc__user_1234"

    User IDs are sanitized: only alphanumeric, underscore, hyphen, dot kept.
    If the result exceeds 128 chars, the user_id portion is SHA-256 truncated.
    """
    channel_short = _CHANNEL_ALIASES.get(channel.lower(), channel.lower()[:4])
    sanitized = re.sub(r"[^a-zA-Z0-9_.\-]", "_", user_id.strip())

    tenant_id = f"{channel_short}__{sanitized}"

    if len(tenant_id) > 128:
        user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:16]
        tenant_id = f"{channel_short}__{user_hash}"

    if not _TENANT_ID_PATTERN.match(tenant_id):
        raise ValueError(f"Invalid tenant_id derived: {tenant_id}")

    return tenant_id


# ---------------------------------------------------------------------------
# AgentCore Runtime invocation
# ---------------------------------------------------------------------------

def _agentcore_client():
    # Long read timeout for synchronous builds (up to 10 minutes)
    config = BotoConfig(read_timeout=660, connect_timeout=10, retries={"max_attempts": 0})
    return boto3.client("bedrock-agentcore", region_name=AWS_REGION, config=config)


def invoke_agent_runtime(
    tenant_id: str,
    message: str,
    model: Optional[str] = None,
    runtime_type: str = "claude",
    ticket_id: str = "",
    use_memory: bool = False,
    assistant_id: str = "",
    workspace_tenant_id: str = "",
    skills: Optional[list] = None,
    tenant_slug: str = "",
    instance_id: str = "",
    mcp_servers: Optional[list] = None,
) -> dict:
    """Invoke AgentCore Runtime with tenant isolation.

    In production: calls AgentCore Runtime API (Firecracker microVM per tenant).
    In demo mode: calls local Agent Container directly (AGENT_CONTAINER_URL env var).

    Args:
        tenant_id: Derived tenant identifier, used as sessionId
        message: User message text
        model: Optional model override
        runtime_type: Which runtime to invoke ("chat" or "code")

    Returns:
        Agent response dict with 'response' key

    Raises:
        RuntimeError: If invocation fails
    """
    # --- THINKWORK_ADDITION: write user message to Convex ---
    convex_send_message("agentcore/ingest-message", {
        "tenantId": tenant_id,
        "role": "user",
        "content": message,
    })
    # --- END THINKWORK_ADDITION ---

    # Demo mode: call local Agent Container directly
    local_url = os.environ.get("AGENT_CONTAINER_URL")
    if local_url:
        result = _invoke_local_container(local_url, tenant_id, message, model)
    elif not (RUNTIME_IDS.get(runtime_type) or RUNTIME_IDS.get("claude") or RUNTIME_IDS.get("chat")):
        raise RuntimeError(
            f"No AgentCore Runtime ID configured for type '{runtime_type}'. "
            "Set it in SSM or environment after creating the AgentCore Runtime."
        )
    else:
        result = _invoke_agentcore(tenant_id, message, model, runtime_type, ticket_id, use_memory=use_memory, assistant_id=assistant_id, workspace_tenant_id=workspace_tenant_id, skills=skills, tenant_slug=tenant_slug, instance_id=instance_id, mcp_servers=mcp_servers)

    # --- THINKWORK_ADDITION: write assistant response to Convex ---
    response_text = result.get("response", json.dumps(result))
    if isinstance(response_text, dict):
        response_text = json.dumps(response_text)
    convex_send_message("agentcore/ingest-message", {
        "tenantId": tenant_id,
        "role": "assistant",
        "content": response_text,
    })
    # --- END THINKWORK_ADDITION ---

    return result


def _invoke_local_container(
    base_url: str, tenant_id: str, message: str, model: Optional[str]
) -> dict:
    """Call a local Agent Container server.py directly (demo/testing mode)."""
    import requests

    payload = {
        "sessionId": tenant_id,
        "tenant_id": tenant_id,
        "message": message,
    }
    if model:
        payload["model"] = model

    start = time.time()
    try:
        resp = requests.post(
            f"{base_url}/invocations",
            json=payload,
            timeout=300,
        )
        duration_ms = int((time.time() - start) * 1000)

        if resp.status_code == 200:
            logger.info(
                "Local container invocation tenant_id=%s duration_ms=%d status=success",
                tenant_id, duration_ms,
            )
            return resp.json()
        else:
            logger.error(
                "Local container invocation failed tenant_id=%s status=%d body=%s",
                tenant_id, resp.status_code, resp.text[:200],
            )
            raise RuntimeError(f"Agent Container returned {resp.status_code}: {resp.text[:200]}")

    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(f"Agent Container not reachable at {base_url}: {e}") from e


def _derive_session_id(tenant_id: str, assistant_id: str = "", runtime_type: str = "") -> str:
    """Derive a stable session ID from the assistant ID and runtime type.

    Each assistant gets one warm Firecracker VM that stays alive across
    messages (AgentCore idle timeout ~15 min). This avoids cold-starting
    a new VM per invocation.

    Includes runtime_type so switching runtime types forces a new session.
    Falls back to tenant_id if no assistant_id is provided (e.g. /route).
    """
    key = assistant_id or tenant_id
    raw = f"session:{key}:{runtime_type}" if runtime_type else f"session:{key}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


def _resolve_runtime_arn(runtime_type: str = "chat") -> str:
    """Resolve the runtime ARN from env or derive from runtime ID."""
    arn = RUNTIME_ARNS.get(runtime_type, "")
    if arn:
        return arn
    runtime_id = RUNTIME_IDS.get(runtime_type) or RUNTIME_IDS.get("claude") or RUNTIME_IDS.get("chat")
    if not runtime_id:
        raise RuntimeError(f"No runtime configured for type '{runtime_type}'")
    # Derive ARN from account + region + runtime ID
    sts = boto3.client("sts", region_name=AWS_REGION)
    account_id = sts.get_caller_identity()["Account"]
    return f"arn:aws:bedrock-agentcore:{AWS_REGION}:{account_id}:runtime/{runtime_id}"


def _invoke_agentcore(tenant_id: str, message: str, model: Optional[str], runtime_type: str = "claude", ticket_id: str = "", **kwargs) -> dict:
    """Call AgentCore Runtime API (production mode)."""
    payload = {
        "sessionId": tenant_id,
        "message": message,
    }
    if model:
        payload["model"] = model
    if ticket_id:
        payload["ticket_id"] = ticket_id
    if kwargs.get("use_memory"):
        payload["use_memory"] = True
    if kwargs.get("assistant_id"):
        payload["assistant_id"] = kwargs["assistant_id"]
    if kwargs.get("workspace_tenant_id"):
        payload["workspace_tenant_id"] = kwargs["workspace_tenant_id"]
    if kwargs.get("skills"):
        payload["skills"] = kwargs["skills"]
    if kwargs.get("tenant_slug"):
        payload["tenant_slug"] = kwargs["tenant_slug"]
    if kwargs.get("instance_id"):
        payload["instance_id"] = kwargs["instance_id"]
    if kwargs.get("mcp_servers"):
        payload["mcp_servers"] = kwargs["mcp_servers"]

    session_id = _derive_session_id(tenant_id, kwargs.get("assistant_id", ""), runtime_type)
    runtime_arn = _resolve_runtime_arn(runtime_type)

    start = time.time()
    try:
        client = _agentcore_client()
        response = client.invoke_agent_runtime(
            agentRuntimeArn=runtime_arn,
            runtimeSessionId=session_id,
            payload=json.dumps(payload),
        )

        # Response body is a StreamingBody object, not a plain dict
        body_bytes = response["response"].read()
        result = json.loads(body_bytes.decode("utf-8"))
        duration_ms = int((time.time() - start) * 1000)

        logger.info(
            "AgentCore invocation tenant_id=%s session_id=%s duration_ms=%d status=success",
            tenant_id, session_id[:16], duration_ms,
        )
        return result

    except ClientError as e:
        duration_ms = int((time.time() - start) * 1000)
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        logger.error(
            "AgentCore invocation failed tenant_id=%s error=%s duration_ms=%d",
            tenant_id, error_code, duration_ms,
        )
        raise RuntimeError(f"AgentCore invocation failed: {error_code}") from e


# ---------------------------------------------------------------------------
# HTTP server — receives webhooks from ServerlessClaw Gateway
# ---------------------------------------------------------------------------

class TenantRouterHandler(BaseHTTPRequestHandler):
    """HTTP handler for the tenant routing proxy.

    Endpoints:
      GET  /health          → health check
      POST /route           → route message to AgentCore Runtime
      POST /route/broadcast → (future) broadcast to multiple tenants
    """

    def log_message(self, fmt, *args):
        logger.info(fmt, *args)

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {
                "status": "ok",
                "runtime_ids": RUNTIME_IDS or {"claude": "not_configured"},
                "stack": STACK_NAME,
            })
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/route":
            self._handle_route()
        elif self.path == "/invoke":
            self._handle_invoke()
        else:
            self._respond(404, {"error": "not found"})

    def _check_bearer_auth(self) -> bool:
        """Validate Bearer token against FLEET_API_SECRET."""
        if not FLEET_API_SECRET:
            return True  # No secret configured — allow (dev mode)
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._respond(401, {"error": "missing Authorization header"})
            return False
        token = auth[7:]
        if not hmac.compare_digest(token, FLEET_API_SECRET):
            self._respond(403, {"error": "invalid token"})
            return False
        return True

    def _handle_invoke(self):
        """POST /invoke — Hive UI chat relay endpoint.

        Accepts: {tenant_id, assistant_id, ticket_id, message, model?}
        Returns: {tenant_id, ticket_id, response: {choices: [...]}}
        """
        if not self._check_bearer_auth():
            return

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, {"error": "invalid json"})
            return

        tenant_id = payload.get("tenant_id", "")
        assistant_id = payload.get("assistant_id", "")
        ticket_id = payload.get("thread_id", "") or payload.get("ticket_id", "")
        message = payload.get("message", "")
        tenant_slug = payload.get("tenant_slug", "")
        instance_id = payload.get("instance_id", "")

        if not tenant_id or not message:
            self._respond(400, {"error": "tenant_id and message required"})
            return

        # Use assistant+thread as a stable session key for AgentCore
        session_tenant = f"{tenant_id}:{assistant_id}:{ticket_id}" if assistant_id else tenant_id

        runtime_type = payload.get("runtime_type", "claude")
        use_memory = payload.get("use_memory", False)
        skills = payload.get("skills")
        mcp_servers = payload.get("mcp_servers")

        try:
            result = invoke_agent_runtime(
                tenant_id=session_tenant,
                message=message,
                model=payload.get("model"),
                runtime_type=runtime_type,
                ticket_id=ticket_id,
                use_memory=use_memory,
                assistant_id=assistant_id,
                workspace_tenant_id=tenant_id,
                skills=skills,
                tenant_slug=tenant_slug,
                instance_id=instance_id,
                mcp_servers=mcp_servers,
            )
            self._respond(200, {
                "tenant_id": tenant_id,
                "ticket_id": ticket_id,
                "response": result,
            })
        except RuntimeError as e:
            self._respond(502, {"error": str(e), "tenant_id": tenant_id})

    def _handle_route(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, {"error": "invalid json"})
            return

        # Extract routing fields
        channel = payload.get("channel", "")
        user_id = payload.get("user_id", "")
        message = payload.get("message", "")

        if not channel or not user_id:
            self._respond(400, {"error": "channel and user_id required"})
            return

        if not message:
            self._respond(400, {"error": "message required"})
            return

        # Derive tenant and route
        try:
            tenant_id = derive_tenant_id(channel, user_id)
        except ValueError as e:
            self._respond(400, {"error": str(e)})
            return

        runtime_type = payload.get("runtime_type", "claude")

        try:
            result = invoke_agent_runtime(
                tenant_id=tenant_id,
                message=message,
                model=payload.get("model"),
                runtime_type=runtime_type,
            )
            self._respond(200, {
                "tenant_id": tenant_id,
                "response": result,
            })
        except RuntimeError as e:
            self._respond(502, {"error": str(e), "tenant_id": tenant_id})

    def _respond(self, status: int, body: dict):
        data = json.dumps(body, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def _load_runtime_id_from_ssm():
    """Load AgentCore Runtime IDs from SSM for each runtime type."""
    global RUNTIME_IDS
    ssm = boto3.client("ssm", region_name=AWS_REGION)

    for runtime_type in ("claude", "code", "claw", "flue", "sdk"):
        if runtime_type in RUNTIME_IDS:
            continue
        ssm_path = f"/thinkwork/{STACK_NAME}/agentcore/runtime-id-{runtime_type}"
        try:
            resp = ssm.get_parameter(Name=ssm_path)
            RUNTIME_IDS[runtime_type] = resp["Parameter"]["Value"]
            logger.info("Loaded runtime_id for %s from SSM: %s", runtime_type, RUNTIME_IDS[runtime_type])
        except Exception as e:
            logger.warning("Could not load runtime_id from SSM path=%s: %s", ssm_path, e)

    # Fallback: legacy single runtime-id maps to "chat"
    if "claude" not in RUNTIME_IDS:
        legacy_path = f"/thinkwork/{STACK_NAME}/agentcore/runtime-id"
        try:
            resp = ssm.get_parameter(Name=legacy_path)
            RUNTIME_IDS["claude"] = resp["Parameter"]["Value"]
            logger.info("Loaded legacy runtime_id as claude: %s", RUNTIME_IDS["claude"])
        except Exception:
            pass

    # Also load from env vars as override
    env_id = os.environ.get("AGENTCORE_RUNTIME_ID", "")
    if env_id and "claude" not in RUNTIME_IDS:
        RUNTIME_IDS["claude"] = env_id


def main():
    _load_runtime_id_from_ssm()

    if not RUNTIME_IDS:
        logger.warning(
            "No AgentCore Runtime IDs configured. Router will start but /route calls will fail. "
            "Set SSM parameters /thinkwork/%s/agentcore/runtime-id-chat and /thinkwork/%s/agentcore/runtime-id-code",
            STACK_NAME, STACK_NAME,
        )

    server = HTTPServer(("0.0.0.0", ROUTER_PORT), TenantRouterHandler)
    logger.info(
        "Tenant Router listening on port %d (stack=%s, runtimes=%s)",
        ROUTER_PORT, STACK_NAME, RUNTIME_IDS or "NOT_SET",
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
