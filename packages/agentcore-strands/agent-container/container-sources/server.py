"""
AgentCore Strands — Multi-model runtime powered by Strands Agent SDK.

Supports any Bedrock model (Claude, Nova, Llama, Mistral) via the Strands
Agent SDK. Tools are loaded via script-based skills (skill_runner.py).
MCP tool servers connected via MCPClient (streamable HTTP transport).
Pure Python — no Node.js dependency.

Build revision: 2026-04-13 — include PR #24 (hindsight async tools).
"""
import asyncio
import json
import logging
import os
import sys

import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Boot-time filesystem check — fails loud with the missing module name(s) when
# the Dockerfile COPY block drifts vs container-sources/. This is defense in
# depth over the wildcard COPY that replaced the per-module explicit list.
from _boot_assert import check as _boot_assert_check  # noqa: E402

_boot_assert_check(os.path.dirname(os.path.abspath(__file__)))

from permissions import read_permission_profile
from observability import log_agent_invocation, log_permission_denied
from safety import validate_message
try:
    from bedrock_request_tracker import install_on_session, get_captured_request_ids, reset_captured_request_ids
    _tracker_available = True
except ImportError:
    _tracker_available = False
    def get_captured_request_ids(): return []
    def reset_captured_request_ids(): pass

_tracker_installed = False
from install_skills import install_skills
import invocation_env

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "/tmp/workspace")
DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6"

def _apply_workspace_bucket_env(bucket: str) -> None:
    if not bucket:
        return
    os.environ["AGENTCORE_FILES_BUCKET"] = bucket
    os.environ["WORKSPACE_BUCKET"] = bucket


_apply_workspace_bucket_env(os.environ.get("AGENTCORE_FILES_BUCKET", ""))

# The personality-template constant used to drive _fetch_memory_templates
# / _bootstrap_personality_files. Those functions are gone (Unit 7) —
# everything flows through the composer now. The list lives in
# @thinkwork/workspace-defaults' CANONICAL_FILE_NAMES on the server side.

# ── Built-in tool cost capture ───────────────────────────────────────────────
_nova_act_api_key: str = ""
_tool_costs: list[dict] = []  # Accumulated per-invocation tool costs


# ─── Composer-backed workspace fetch (Unit 7) ────────────────────────────────
#
# The container used to (a) download files directly from S3 and (b) bootstrap
# missing personality files by fetching templates, substituting
# {{AGENT_NAME}} / {{HUMAN_NAME}} locally, and writing the substituted content
# BACK to S3. That third step forked every agent's S3 state on first boot and
# defeated the overlay composer's first-hit-wins rule.
#
# Now the container asks the composer (Unit 4) for the fully composed
# workspace in one HTTP call — tenant is validated server-side, placeholder
# substitution happens server-side, and nothing is written back to S3.
#
# The HTTP client lives in workspace_composer_client.py so it can be
# unit-tested without importing the full Strands runtime.

from bootstrap_workspace import bootstrap_workspace
from user_storage import PackResult, get_user_knowledge_pack


# Per-user knowledge pack — separate prompt-injection concern from the
# workspace sync. Refreshed at the same per-invocation cadence as the
# workspace bootstrap.
_PACK_CACHE: PackResult | None = None


def _retrieve_kb_context(kb_config: list, query: str, max_results: int = 5) -> str:
    """Call Bedrock Retrieve API for all assigned KBs and return formatted context."""
    try:
        client = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)
    except Exception as e:
        logger.warning("Failed to create Bedrock client for KB retrieval: %s", e)
        return ""

    all_chunks = []
    for kb in kb_config:
        kb_id = kb.get("awsKbId", "")
        if not kb_id:
            continue
        try:
            search_config = kb.get("searchConfig") or {}
            resp = client.retrieve(
                knowledgeBaseId=kb_id,
                retrievalQuery={"text": query},
                retrievalConfiguration={
                    "vectorSearchConfiguration": {
                        "numberOfResults": search_config.get("maxResults", max_results),
                    },
                },
            )
            for item in resp.get("retrievalResults", []):
                text = item.get("content", {}).get("text", "")
                score = item.get("score", 0)
                source = ""
                loc = item.get("location", {})
                if loc.get("type") == "S3":
                    uri = loc.get("s3Location", {}).get("uri", "")
                    source = uri.split("/")[-1] if uri else ""
                if text:
                    all_chunks.append({"text": text, "score": score, "source": source, "kb": kb.get("name", "")})
        except Exception as e:
            logger.warning("KB retrieval failed for %s: %s", kb_id, e)

    if not all_chunks:
        return ""

    all_chunks.sort(key=lambda x: x.get("score", 0), reverse=True)
    all_chunks = all_chunks[:max_results]

    lines = ["## Retrieved Knowledge Base Context", "",
             "The following excerpts were retrieved from your knowledge bases based on the user's message. "
             "Use this information to inform your response.", ""]
    for i, chunk in enumerate(all_chunks, 1):
        source_info = f" (source: {chunk['source']})" if chunk.get("source") else ""
        kb_info = f" [KB: {chunk['kb']}]" if len(kb_config) > 1 else ""
        lines.append(f"### Excerpt {i}{kb_info}{source_info}")
        lines.append(chunk["text"])
        lines.append("")

    context = "\n".join(lines)
    logger.info("KB retrieval: %d chunks, %d chars for query: %s", len(all_chunks), len(context), query[:100])
    return context


from external_task_context import format_external_task_context
from workflow_skill_context import format_workflow_skill_context


def _build_system_prompt(skills_config: list | None = None, kb_config: list | None = None,
                         profile=None) -> str:
    """Build system prompt from workspace files + installed skills + KB info.

    If a ContextProfile is provided, only load files listed in the profile.
    Otherwise, fall back to loading all known workspace files (backward compatible).
    """
    parts = []

    if profile:
        # Profile-aware: load only files specified by the resolved profile
        from router_parser import expand_file_list
        file_paths = expand_file_list(WORKSPACE_DIR, profile.load)
        for rel_path in file_paths:
            filepath = os.path.join(WORKSPACE_DIR, rel_path)
            try:
                with open(filepath) as f:
                    content = f.read().strip()
                if content:
                    parts.append(content)
            except Exception as e:
                logger.warning("Failed to read %s: %s", rel_path, e)
        logger.info("Profile-aware prompt: loaded %d workspace files", len(parts))
    else:
        # Legacy: load all known workspace files.
        # AGENTS.md (the map) and CONTEXT.md (the router) are always loaded when present.
        # They replace SKILL.md injection by providing a catalog of available skills/tools.
        for filename in ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md", "CONTEXT.md", "TOOLS.md"]:
            filepath = os.path.join(WORKSPACE_DIR, filename)
            if os.path.isfile(filepath):
                try:
                    with open(filepath) as f:
                        content = f.read().strip()
                    if content:
                        parts.append(content)
                except Exception as e:
                    logger.warning("Failed to read %s: %s", filepath, e)

    # PRD-31: Skill content is handled by the AgentSkills plugin (progressive disclosure).
    # The plugin injects <available_skills> XML and provides a `skills` tool for on-demand loading.
    # When AGENTS.md exists (workspace mode), sub-agents handle their own skills.
    has_workspace_map = os.path.isfile(os.path.join(WORKSPACE_DIR, "AGENTS.md"))

    if skills_config and not has_workspace_map:
        logger.info("AgentSkills plugin handles %d skills via progressive disclosure", len(skills_config))
    elif has_workspace_map:
        logger.info("AGENTS.md found — skipping skill injection (%d skills in map)",
                     len(skills_config) if skills_config else 0)

    # U6: the PRD-40 execution-type context-body loop that inlined every
    # execution: context skill's SKILL.md body into the system prompt is
    # gone. With U5's `Skill` meta-tool live, skill bodies load on demand
    # via `Skill(name=...)` instead of riding in every turn's prompt.

    # Add knowledge base information to system prompt
    if kb_config:
        kb_lines = ["## Knowledge Bases", "",
                     "You have access to the following knowledge bases via the `knowledge_base_search` tool. "
                     "Use this tool to find relevant information from uploaded documents before answering questions "
                     "about company policies, procedures, or reference material.", ""]
        for kb in kb_config:
            name = kb.get("name", "Unknown")
            desc = kb.get("description", "")
            kb_lines.append(f"- **{name}**" + (f": {desc}" if desc else ""))
        parts.append("\n".join(kb_lines))

    # Inject current date so the agent knows "today" and "tomorrow"
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("America/Chicago"))
    parts.insert(0, f"Current date: {now.strftime('%A, %B %d, %Y')} ({now.strftime('%Z')})")

    # Prepend system workspace files (after date, before org workspace)
    from install_skills import SYSTEM_WORKSPACE_DIR
    system_parts = []
    for filename in ["PLATFORM.md", "CAPABILITIES.md", "GUARDRAILS.md", "MEMORY_GUIDE.md"]:
        filepath = os.path.join(SYSTEM_WORKSPACE_DIR, filename)
        if os.path.isfile(filepath):
            try:
                with open(filepath) as f:
                    content = f.read().strip()
                if content:
                    system_parts.append(content)
            except Exception as e:
                logger.warning("Failed to read system file %s: %s", filename, e)
    if system_parts:
        # Insert system files after date (index 0) but before workspace files
        for i, sp in enumerate(system_parts):
            parts.insert(1 + i, sp)
        logger.info("Loaded %d system workspace files", len(system_parts))

    if _PACK_CACHE and _PACK_CACHE.body.strip():
        insert_at = 1 + len(system_parts)
        parts.insert(insert_at, _PACK_CACHE.body.strip())
        user_id = (
            os.environ.get("USER_ID", "")
            or os.environ.get("CURRENT_USER_ID", "")
        )
        tenant_id = (
            os.environ.get("TENANT_ID", "")
            or os.environ.get("_MCP_TENANT_ID", "")
        )
        token_count = max(1, len(_PACK_CACHE.body) // 4)
        logger.info(
            "pack_injected tenant_id=%s user_id=%s scope=user "
            "token_count=%d chars=%d etag=%s",
            tenant_id,
            user_id,
            token_count,
            len(_PACK_CACHE.body),
            (_PACK_CACHE.etag or "")[:12],
            extra={
                "event_type": "pack_injected",
                "tenant_id": tenant_id,
                "user_id": user_id,
                "scope": "user",
                "token_count": token_count,
            },
        )
        if _PACK_CACHE.last_modified is not None:
            try:
                from datetime import datetime, timezone

                last_modified = _PACK_CACHE.last_modified
                if last_modified.tzinfo is None:
                    last_modified = last_modified.replace(tzinfo=timezone.utc)
                age_seconds = max(
                    0,
                    int(
                        (
                            datetime.now(timezone.utc) - last_modified
                        ).total_seconds()
                    ),
                )
                logger.info(
                    "pack_age_at_load_seconds tenant_id=%s user_id=%s "
                    "scope=user age_seconds=%d",
                    tenant_id,
                    user_id,
                    age_seconds,
                    extra={
                        "event_type": "pack_age_at_load_seconds",
                        "tenant_id": tenant_id,
                        "user_id": user_id,
                        "scope": "user",
                        "age_seconds": age_seconds,
                    },
                )
            except Exception as exc:
                logger.debug("pack age calculation skipped: %s", exc)

    if len(parts) > 0:
        logger.info("System prompt built from %d parts, total chars=%d", len(parts), sum(len(p) for p in parts))
        return "\n\n---\n\n".join(parts)
    else:
        logger.warning("No workspace files found in %s", WORKSPACE_DIR)
        return "You are a helpful assistant."


def _ensure_workspace_ready(workspace_tenant_id: str, assistant_id: str,
                            skills_config: list | None = None,
                            tenant_slug: str = "", instance_id: str = "",
                            agent_name: str = "", human_name: str = ""):
    """Sync the agent's S3 prefix to /tmp/workspace.

    Per docs/plans/2026-04-27-003 (materialize-at-write-time): the agent's
    S3 prefix is the only thing the runtime reads. List the prefix,
    download every file, delete locals that disappeared upstream. No
    overlay, no template/defaults fallback, no read-time substitution.

    Runs on every invocation (not cold-start-only). Operator edits land
    on the next turn without any cache-invalidation choreography.

    Also refreshes the user knowledge pack (separate per-user prompt
    injection) — same per-invocation cadence.
    """
    global _PACK_CACHE

    if not workspace_tenant_id or not assistant_id:
        os.makedirs(WORKSPACE_DIR, exist_ok=True)
        return

    bucket = (
        os.environ.get("WORKSPACE_BUCKET")
        or os.environ.get("AGENTCORE_FILES_BUCKET")
        or ""
    )
    ws_tenant = tenant_slug or workspace_tenant_id
    ws_instance = instance_id or assistant_id

    os.makedirs(WORKSPACE_DIR, exist_ok=True)

    if not bucket or not ws_tenant or not ws_instance:
        logger.warning(
            "workspace_sync action=skip reason=missing_config bucket=%r tenant=%r instance=%r",
            bool(bucket), bool(ws_tenant), bool(ws_instance),
        )
        return

    t_sync = time.time()
    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        result = bootstrap_workspace(
            tenant_slug=ws_tenant,
            agent_slug=ws_instance,
            local_dir=WORKSPACE_DIR,
            s3_client=s3,
            bucket=bucket,
        )
    except Exception as e:
        logger.warning("workspace_sync bootstrap failed: %s", e)
        return

    sync_ms = round((time.time() - t_sync) * 1000)
    logger.info(
        "workspace_sync action=bootstrap sync_ms=%d synced=%d deleted=%d total=%d",
        sync_ms, result.synced, result.deleted, result.total,
    )

    # User knowledge pack — separate per-user prompt injection. Refreshed
    # at the same cadence as the workspace sync.
    user_id = os.environ.get("USER_ID", "") or os.environ.get("CURRENT_USER_ID", "")
    if user_id:
        _PACK_CACHE = get_user_knowledge_pack(
            workspace_tenant_id,
            user_id,
            bucket=bucket,
        )
    else:
        _PACK_CACHE = None
        logger.info(
            "pack_skipped reason=no_user_id tenant_id=%s agent_id=%s",
            workspace_tenant_id,
            assistant_id,
            extra={
                "event_type": "pack_skipped",
                "reason": "no_user_id",
                "tenant_id": workspace_tenant_id,
                "agent_id": assistant_id,
                "scope": "user",
            },
        )


# Structured-log event_type vocabulary for the delegate_to_workspace
# registration helper. Operator dashboards filter on these values; rename
# any of them and the alert wiring breaks. Tests assert on the constants
# (not the literals) so a future rename is forced through this single
# source. Per `project_agentcore_deploy_race_env` the WARN-level skipped
# event is what surfaces partial-fleet env drift.
EVENT_TOOL_REGISTERED = "tool_registered"
EVENT_TOOL_REGISTRATION_SKIPPED = "tool_registration_skipped"
EVENT_TOOL_REGISTRATION_FAILED = "tool_registration_failed"


def _register_delegate_to_workspace_tool(
    *,
    tools: list,
    tool_decorator,
    skill_meta: dict,
    effective_model: str,
    sub_agent_usage: list,
) -> None:
    """Register the ``delegate_to_workspace`` tool against ``tools`` in place.

    Extracted from ``_call_strands_agent`` so the registration block has a
    direct test surface (Plan §008 U6). Side effects:

    - On success: appends the wrapped tool to ``tools`` and emits an INFO
      log line ("registered" is informational, not an alert).
    - On missing env: emits a structured WARNING with
      ``event_type="tool_registration_skipped"`` + ``missing=[...]`` so
      operator dashboards can aggregate which env var was empty per
      ``project_agentcore_deploy_race_env``. Does NOT mutate ``tools``.
    - On ``ImportError`` while importing ``delegate_to_workspace_tool``:
      emits a structured WARNING with ``event_type="tool_registration_failed"``.

    The structured ``extra={"event_type": ...}`` field is the
    dashboard-aggregation key; CloudWatch Logs Insights queries on the
    operator dashboard filter on it. No new SDK / EMF code.
    """
    try:
        from delegate_to_workspace_tool import make_delegate_to_workspace_fn
    except ImportError as exc:
        logger.warning(
            "delegate_to_workspace_tool import failed (%s); skipping registration",
            exc,
            extra={
                "event_type": EVENT_TOOL_REGISTRATION_FAILED,
                "tool": "delegate_to_workspace",
            },
        )
        return

    _dw_api_url = (
        os.environ.get("THINKWORK_API_URL")
        or os.environ.get("API_URL")
        or ""
    )
    _dw_api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("INTERNAL_API_SECRET")
        or ""
    )
    _dw_tenant = os.environ.get("TENANT_ID", "")
    _dw_agent = os.environ.get("AGENT_ID", "") or os.environ.get("_ASSISTANT_ID", "")
    _hs_endpoint = os.environ.get("HINDSIGHT_ENDPOINT", "")
    _hs_user = os.environ.get("USER_ID", "") or os.environ.get("CURRENT_USER_ID", "")
    _hs_bank = f"user_{_hs_user}" if _hs_user else ""
    _hs_owner_id = _hs_user
    _hs_tenant = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
    _hs_stage = os.environ.get("STAGE", "") or "unknown"
    _memory_tool_context = {
        "hs_endpoint": _hs_endpoint,
        "hs_bank": _hs_bank,
        "hs_tenant": _hs_tenant,
        "hs_owner_id": _hs_owner_id,
        "hs_tags": [
            f"agent_id:{_dw_agent}",
            f"user_id:{_hs_user}",
            f"tenant_id:{_hs_tenant}",
            f"env:{_hs_stage or 'unknown'}",
        ],
        "wiki_tenant_id": _hs_tenant,
        "wiki_owner_id": _hs_owner_id,
        "knowledge_pack_body": _PACK_CACHE.body if _PACK_CACHE else "",
        "knowledge_pack_etag": _PACK_CACHE.etag if _PACK_CACHE else "",
    }

    missing: list[str] = []
    if not _dw_api_url:
        missing.append("THINKWORK_API_URL")
    if not _dw_api_secret:
        missing.append("API_AUTH_SECRET")
    if not _dw_tenant:
        missing.append("TENANT_ID")
    if not _dw_agent:
        missing.append("AGENT_ID")

    if missing:
        logger.warning(
            "delegate_to_workspace tool not registered — missing env: %s",
            ",".join(missing),
            extra={
                "event_type": EVENT_TOOL_REGISTRATION_SKIPPED,
                "tool": "delegate_to_workspace",
                "missing": missing,
            },
        )
        return

    # Build the platform-catalog manifest expected by `skill_resolver`
    # from the workspace-copied skills. Shape required:
    #   Mapping[str, Mapping[str, Any]] with `skill_md_content` per entry.
    _dw_platform_manifest: dict[str, dict[str, str]] = {}
    for _slug, _meta in skill_meta.items():
        _skill_md = _meta.get("skill_md_path") or os.path.join(
            WORKSPACE_DIR, "skills", _slug, "SKILL.md"
        )
        try:
            with open(_skill_md) as _fh:
                _content = _fh.read()
        except OSError as _exc:
            logger.warning(
                "platform_catalog_manifest: failed to read %s (%s); skipping entry",
                _skill_md,
                _exc,
            )
            continue
        if not _content:
            logger.warning(
                "platform_catalog_manifest: SKILL.md at %s is empty; skipping entry",
                _skill_md,
            )
            continue
        _dw_platform_manifest[_slug] = {"skill_md_content": _content}

    _dw_fn = make_delegate_to_workspace_fn(
        parent_tenant_id=_dw_tenant,
        parent_agent_id=_dw_agent,
        api_url=_dw_api_url,
        api_secret=_dw_api_secret,
        platform_catalog_manifest=_dw_platform_manifest,
        cfg_model=effective_model,
        usage_acc=sub_agent_usage,
        tool_context=_memory_tool_context,
    )
    tools.append(tool_decorator(_dw_fn))
    logger.info(
        "delegate_to_workspace tool registered "
        "(model=%s, spawn=live, platform_manifest_entries=%d)",
        effective_model,
        len(_dw_platform_manifest),
        extra={
            "event_type": EVENT_TOOL_REGISTERED,
            "tool": "delegate_to_workspace",
            "platform_manifest_entries": len(_dw_platform_manifest),
        },
    )


def _build_mcp_clients(mcp_configs: list | None) -> list:
    """Build Strands MCP clients from runtime config.

    Kept as a helper so tests can verify auth-header propagation without
    constructing a Bedrock-backed Agent.
    """
    mcp_clients = []
    logger.info("MCP configs received: %d servers, raw=%s",
                len(mcp_configs or []),
                json.dumps([{k: ("***" if k == "auth" else v)
                             for k, v in cfg.items()} for cfg in (mcp_configs or [])], default=str))
    for cfg in (mcp_configs or []):
        url = cfg.get("url", "")
        if not url:
            logger.warning("MCP config has no url, skipping: %s", cfg)
            continue
        server_name = cfg.get("name", url)
        headers = {}
        auth = cfg.get("auth") or {}
        has_token = bool(auth.get("token"))
        logger.info("MCP connecting: name=%s url=%s has_auth=%s auth_type=%s",
                    server_name, url, has_token, auth.get("type", "none"))
        if auth.get("token"):
            auth_type = auth.get("type", "bearer")
            if auth_type == "bearer":
                headers["Authorization"] = f"Bearer {auth['token']}"
            elif auth_type == "api-key":
                headers["x-api-key"] = auth["token"]
        try:
            from strands.tools.mcp import MCPClient
            from mcp.client.streamable_http import streamablehttp_client
            logger.info("MCP creating client for %s with %d headers", server_name, len(headers))
            client = MCPClient(lambda u=url, h=headers: streamablehttp_client(url=u, headers=h))
            # Don't call start() — the Agent will start the client and load tools automatically.
            # Just register the client as a tool provider.
            mcp_clients.append(client)
            logger.info("MCP client registered: %s url=%s (tools will be discovered by Agent)", server_name, url)
        except Exception as e:
            import traceback
            logger.error("MCP connection FAILED for %s (%s): %s\n%s", server_name, url, e, traceback.format_exc())

    return mcp_clients


def _call_strands_agent(system_prompt: str, messages: list,
                        model: str = "",
                        skills_config: list | None = None,
                        guardrail_config: dict | None = None,
                        mcp_configs: list | None = None,
                        disabled_builtin_tools: list | None = None,
                        template_blocked_tools: list | None = None,
                        web_search_config: dict | None = None,
                        send_email_config: dict | None = None,
                        context_engine_enabled: bool = False,
                        browser_automation_enabled: bool = False) -> tuple[str, dict]:
    """Invoke Strands Agent SDK.

    ``disabled_builtin_tools`` / ``template_blocked_tools`` implement the
    U12 tenant kill-switch + template block. Both default to no-op when the
    caller does not pass them (inert ship — chat-agent-invoke / wakeup
    Lambda will populate them once the admin path supplies the values).

    Returns (response_text, usage_dict).
    """
    from strands import Agent
    from strands.models import BedrockModel

    # 1. Create BedrockModel with prompt caching enabled.
    effective_model = model or DEFAULT_MODEL
    try:
        from strands.models.bedrock import CacheConfig
        cache_cfg = CacheConfig(strategy="auto")
    except ImportError:
        cache_cfg = None

    bedrock_kwargs = {}
    if cache_cfg:
        bedrock_kwargs["cache_config"] = cache_cfg
    if guardrail_config:
        bedrock_kwargs["guardrail_id"] = guardrail_config["guardrailIdentifier"]
        bedrock_kwargs["guardrail_version"] = guardrail_config["guardrailVersion"]
        bedrock_kwargs["guardrail_trace"] = "enabled"
        logger.info("Bedrock guardrail enabled: id=%s version=%s",
                     guardrail_config["guardrailIdentifier"],
                     guardrail_config["guardrailVersion"])

    bedrock_model = BedrockModel(
        model_id=effective_model,
        region_name=AWS_REGION,
        streaming=True,
        **bedrock_kwargs,
    )

    # 2. Pre-load conversation history
    # Convert messages to Strands/Converse format: {role, content: [{text: "..."}]}
    def _to_converse_msg(msg):
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            return {"role": role, "content": [{"text": content}]}
        if isinstance(content, list):
            # Already in block format
            return {"role": role, "content": content}
        return {"role": role, "content": [{"text": str(content)}]}

    history = [_to_converse_msg(m) for m in messages[:-1]] if len(messages) > 1 else []
    current_msg = messages[-1].get("content", "") if messages else ""
    # Flatten text content for current message
    if isinstance(current_msg, list):
        current_msg = " ".join(b.get("text", "") for b in current_msg if isinstance(b, dict))

    logger.info("Invoking Strands agent: model=%s, history=%d msgs, prompt_len=%d, system_len=%d",
                effective_model, len(history), len(current_msg), len(system_prompt))

    # 3. Build tool list: memory tools + policy-enabled built-ins + file_read + script skills
    tools = []

    # Memory: AgentCore managed memory is ALWAYS registered. Automatic per-turn
    # retention (store_turn_pair hook in do_POST) feeds the background strategies,
    # and the remember/recall/forget tools expose explicit reads/writes to the
    # model. Hindsight is an optional ADD-ON registered alongside when
    # HINDSIGHT_ENDPOINT is set in the environment.
    try:
        from memory_tools import remember, recall, forget
        tools.extend([remember, recall, forget])
        logger.info("Managed memory tools registered: remember, recall, forget")
    except Exception as e:
        logger.warning("Managed memory tools registration failed: %s", e)

    # Unit 7 + Plan §008 U12: write_memory — agent (parent or sub-agent)
    # writes memory/*.md notes via the composer. Path is `(folder/)?memory/
    # (lessons|preferences|contacts).md` from the agent root, validated by
    # `_validate_memory_path` (NFKC + regex + reserved-segment + depth-5).
    try:
        from write_memory_tool import write_memory
        tools.append(write_memory)
        logger.info("workspace tool registered: write_memory")
    except Exception as e:
        logger.warning("write_memory registration failed: %s", e)

    try:
        from wake_workspace_tool import make_wake_workspace_from_env
        tools.append(make_wake_workspace_from_env())
        logger.info("workspace tool registered: wake_workspace")
    except Exception as e:
        logger.warning("wake_workspace registration failed: %s", e)

    # Self-serve agent tools (docs/plans/2026-04-22-003-...-plan.md):
    #   - update_agent_name: agent renames itself
    #   - update_identity: agent edits its own IDENTITY.md personality fields
    #   - update_user_profile: agent edits the paired human's structured profile
    try:
        from update_agent_name_tool import update_agent_name
        tools.append(update_agent_name)
        logger.info("workspace tool registered: update_agent_name")
    except Exception as e:
        logger.warning("update_agent_name registration failed: %s", e)

    try:
        from update_identity_tool import update_identity
        tools.append(update_identity)
        logger.info("workspace tool registered: update_identity")
    except Exception as e:
        logger.warning("update_identity registration failed: %s", e)

    try:
        from update_user_profile_tool import update_user_profile
        tools.append(update_user_profile)
        logger.info("workspace tool registered: update_user_profile")
    except Exception as e:
        logger.warning("update_user_profile registration failed: %s", e)

    # AgentCore Code Sandbox execute_code tool (plan Unit 7).
    # Registered only when the dispatcher has populated SANDBOX_INTERPRETER_ID
    # on the invocation env — the pre-flight helper (plan Unit 9) decides
    # whether to set it based on the template's sandbox opt-in + tenant
    # policy + interpreter-ready state. Held outside tool_cleanups so the
    # per-turn session can be torn down in the finally block below.
    _sandbox_cleanup_fn = None
    if os.environ.get("SANDBOX_INTERPRETER_ID"):
        try:
            from strands import tool as _sb_tool_decorator
            from sandbox_tool import build_execute_code_tool, new_session_state
            from sandbox_preamble import build_preamble
            import boto3 as _sb_boto3

            # Raw boto3 bedrock-agentcore client. The SDK's
            # `code_session` context manager wrapper was unreliable
            # across versions (its return value has different probe
            # shapes depending on release). Using the boto3 client
            # directly pins us to the documented public API —
            # StartCodeInterpreterSession, InvokeCodeInterpreter,
            # StopCodeInterpreterSession — and doesn't guess method
            # names.
            _sb_client = _sb_boto3.client(
                "bedrock-agentcore",
                region_name=os.environ.get("AWS_REGION", "us-east-1"),
            )
            _sb_state = new_session_state()

            # Preamble is executeCode call #1 — sitecustomize readiness
            # check only. The retired OAuth token injection path is gone
            # (see docs/plans/2026-04-23-006).
            _sb_preamble_source = build_preamble()

            def _consume_invoke_stream(stream) -> dict:
                """Drain InvokeCodeInterpreter's event stream into
                {stdout, stderr, exit_code}.

                AgentCore follows the MCP tool-result shape. Each
                stream event wraps a `result` with:
                  - content: list of content blocks (type='text' carries
                    stdout, type='resource' carries file handles, etc.)
                  - structuredContent: {stdout, stderr, exitCode, ...}
                  - isError: terminal failure flag

                We prefer structuredContent when present (authoritative
                single-shot fields), then fall back to concatenating
                text-type content blocks as stdout. Keeps a debug log of
                raw event shapes so future SDK tweaks surface in
                CloudWatch without another grep-and-guess round.
                """
                stdout_chunks: list[str] = []
                stderr_chunks: list[str] = []
                exit_code = 0
                is_error = False
                raw_structured = None

                for event in stream:
                    if not isinstance(event, dict):
                        continue
                    # INFO for now so the first post-deploy invocation's
                    # structure is visible in CloudWatch; downgrade to
                    # DEBUG in a follow-up once the shape is confirmed.
                    logger.info("sandbox stream event shape: %s", list(event.keys()))
                    # Event usually wraps a single top-level key (`result`
                    # or the chunk type). Walk all values so a new
                    # top-level key from an SDK update doesn't silently
                    # drop output.
                    for _k, _v in event.items():
                        if not isinstance(_v, dict):
                            # Rare shape — top-level bytes/str stdout.
                            if isinstance(_v, (bytes, str)):
                                txt = _v.decode() if isinstance(_v, bytes) else _v
                                if _k.lower().startswith("stderr"):
                                    stderr_chunks.append(txt)
                                elif _k.lower().startswith("stdout"):
                                    stdout_chunks.append(txt)
                            continue
                        # structuredContent is authoritative when the
                        # API emits it (usually on terminal event).
                        sc = _v.get("structuredContent")
                        if isinstance(sc, dict):
                            raw_structured = sc
                            if isinstance(sc.get("stdout"), str):
                                stdout_chunks.append(sc["stdout"])
                            if isinstance(sc.get("stderr"), str):
                                stderr_chunks.append(sc["stderr"])
                            if isinstance(sc.get("exitCode"), (int, float)):
                                exit_code = int(sc["exitCode"])
                        # Content blocks — concatenate text-type output.
                        for block in _v.get("content") or []:
                            if not isinstance(block, dict):
                                continue
                            btype = block.get("type", "")
                            if btype == "text" and isinstance(block.get("text"), str):
                                # Don't double-count if structuredContent.stdout
                                # already has this text. Defensive: if sc
                                # wasn't present, the text blocks are the
                                # only stdout source we have.
                                if raw_structured is None:
                                    stdout_chunks.append(block["text"])
                        if _v.get("isError") is True:
                            is_error = True

                stdout = "".join(stdout_chunks)
                stderr = "".join(stderr_chunks)
                if is_error and exit_code == 0:
                    exit_code = 1
                return {
                    "stdout": stdout,
                    "stderr": stderr,
                    "exit_code": exit_code,
                }

            async def _start_session(ipi: str, timeout: int) -> str:
                import asyncio as _a
                loop = _a.get_event_loop()

                def _start():
                    resp = _sb_client.start_code_interpreter_session(
                        codeInterpreterIdentifier=ipi,
                        sessionTimeoutSeconds=timeout,
                    )
                    session_id = resp.get("sessionId") or resp.get("SessionId") or ""
                    _sb_state["session_id"] = session_id
                    _sb_state["interpreter_id"] = ipi
                    # Preamble runs as executeCode call #1 — the
                    # sitecustomize readiness check. User code runs
                    # as call #2+. Failing here aborts the session
                    # before user code sees an unmitigated image.
                    stream = _sb_client.invoke_code_interpreter(
                        codeInterpreterIdentifier=ipi,
                        sessionId=session_id,
                        name="executeCode",
                        arguments={"code": _sb_preamble_source, "language": "python"},
                    )
                    # Drain the stream to surface any preamble error.
                    _consume_invoke_stream(stream.get("stream", []))
                    return session_id

                return await loop.run_in_executor(None, _start)

            async def _stop_session(ipi: str, sess: str) -> None:
                import asyncio as _a
                loop = _a.get_event_loop()

                def _stop():
                    try:
                        _sb_client.stop_code_interpreter_session(
                            codeInterpreterIdentifier=ipi,
                            sessionId=sess,
                        )
                    except Exception as e:
                        logger.warning("StopSession failed: %s", e)

                await loop.run_in_executor(None, _stop)

            async def _run_code(ipi: str, sess: str, code: str) -> dict:
                import asyncio as _a
                loop = _a.get_event_loop()

                def _run():
                    stream = _sb_client.invoke_code_interpreter(
                        codeInterpreterIdentifier=ipi,
                        sessionId=sess,
                        name="executeCode",
                        arguments={"code": code, "language": "python"},
                    )
                    return _consume_invoke_stream(stream.get("stream", []))

                return await loop.run_in_executor(None, _run)

            # Quota circuit breaker (plan Unit 10). Posts to the narrow
            # /api/sandbox/quota/check-and-increment endpoint with
            # Bearer API_AUTH_SECRET before every tool call. On denial
            # or transport failure, the tool surfaces SandboxCapExceeded
            # without touching the interpreter — fail-closed discipline
            # per plan R-Q8.
            _sb_api_url = (
                os.environ.get("THINKWORK_API_URL")
                or os.environ.get("MCP_BASE_URL")
                or ""
            )
            _sb_api_secret = (
                os.environ.get("API_AUTH_SECRET")
                or os.environ.get("THINKWORK_API_SECRET")
                or ""
            )
            _sb_tenant = os.environ.get("TENANT_ID", "")
            _sb_agent = os.environ.get("AGENT_ID", "")

            async def _check_quota() -> dict:
                # Stage without the endpoint wired → bypass. Fail-closed
                # only applies when the endpoint is configured; a dev
                # stage without it shouldn't dead-letter every call.
                if not _sb_api_url or not _sb_api_secret:
                    return {"ok": True}
                import asyncio as _a
                import json as _j
                from urllib.request import Request, urlopen
                loop = _a.get_event_loop()

                def _post() -> dict:
                    body = _j.dumps({
                        "tenant_id": _sb_tenant,
                        "agent_id": _sb_agent,
                    }).encode("utf-8")
                    req = Request(
                        f"{_sb_api_url.rstrip('/')}/api/sandbox/quota/check-and-increment",
                        data=body,
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {_sb_api_secret}",
                        },
                        method="POST",
                    )
                    try:
                        with urlopen(req, timeout=5) as resp:
                            return _j.loads(resp.read().decode("utf-8"))
                    except Exception as _err:  # noqa: BLE001
                        # HTTPError carries .read() — 429 denials land here
                        # because urlopen treats them as HTTP errors.
                        payload_text = getattr(_err, "read", lambda: b"")()
                        try:
                            parsed = _j.loads(payload_text.decode("utf-8"))
                            if isinstance(parsed, dict):
                                parsed.setdefault("ok", False)
                                return parsed
                        except Exception:
                            pass
                        raise

                return await loop.run_in_executor(None, _post)

            # Audit writer (plan Unit 11). Posts to the narrow
            # /api/sandbox/invocations endpoint after every executeCode
            # call. Non-blocking for the agent turn — the sandbox_tool
            # swallows any exception this raises. When the endpoint
            # isn't wired (no URL/secret), skip silently so dev stages
            # without it don't dead-letter.
            async def _log_invocation(row: dict) -> None:
                if not _sb_api_url or not _sb_api_secret:
                    return
                import asyncio as _a
                import json as _j
                from urllib.request import Request, urlopen
                loop = _a.get_event_loop()

                def _post() -> None:
                    body = _j.dumps(row).encode("utf-8")
                    req = Request(
                        f"{_sb_api_url.rstrip('/')}/api/sandbox/invocations",
                        data=body,
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {_sb_api_secret}",
                        },
                        method="POST",
                    )
                    # Short timeout — an audit row write shouldn't
                    # block the agent response more than a beat.
                    with urlopen(req, timeout=3) as resp:
                        resp.read()

                await loop.run_in_executor(None, _post)

            execute_code = build_execute_code_tool(
                strands_tool_decorator=_sb_tool_decorator,
                session_state=_sb_state,
                start_session=_start_session,
                stop_session=_stop_session,
                run_code=_run_code,
                check_quota=_check_quota,
                log_invocation=_log_invocation,
            )
            tools.append(execute_code)
            _sandbox_cleanup_fn = getattr(execute_code, "_sandbox_cleanup", None)
            logger.info(
                "sandbox tool registered: execute_code (interpreter=%s env=%s)",
                os.environ.get("SANDBOX_INTERPRETER_ID"),
                os.environ.get("SANDBOX_ENVIRONMENT"),
            )
        except Exception as e:
            # Dispatcher thinks the sandbox should be live, but the runtime
            # can't wire it up. Fail loud — the startup assertion below
            # converts this into a turn-level error.
            logger.error("sandbox tool registration failed: %s", e)
            raise

    _hindsight_enabled = bool(os.environ.get("HINDSIGHT_ENDPOINT"))
    if _hindsight_enabled:
        # Hindsight memory: retain/recall/reflect tools backed by the
        # Hindsight ECS service. The reusable factory keeps root-agent and
        # delegated sub-agent registration on the same async lifecycle.
        try:
            try:
                import hindsight_usage_capture

                hindsight_usage_capture.install_loop_fix()
                hindsight_usage_capture.install()
                hindsight_usage_capture.reset()
            except Exception as ucap_err:
                logger.warning("hindsight_usage_capture install failed: %s", ucap_err)

            from hindsight_tools import make_hindsight_tools
            from strands import tool as _strands_tool

            hs_endpoint = os.environ.get("HINDSIGHT_ENDPOINT", "")
            hs_user = os.environ.get("USER_ID", "") or os.environ.get("CURRENT_USER_ID", "")
            hs_bank = f"user_{hs_user}" if hs_user else ""
            hs_tenant = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
            hs_assistant = os.environ.get("_ASSISTANT_ID", "")
            hs_stage = os.environ.get("STAGE", "") or "unknown"
            hs_tags = [
                f"agent_id:{hs_assistant}",
                f"user_id:{hs_user}",
                f"tenant_id:{hs_tenant}",
                f"env:{hs_stage or 'unknown'}",
            ]

            hs_tools = make_hindsight_tools(
                _strands_tool,
                hs_endpoint=hs_endpoint,
                hs_bank=hs_bank,
                hs_tags=hs_tags,
            )
            if hs_tools:
                tools.extend(hs_tools)

                # Compounding Memory (wiki) tools — same user scope as Hindsight.
                # Owner id is captured in the closure so the model can never
                # address a different user's wiki. Tools return a graceful
                # "not enabled" string if the graphql-http URL/secret env vars
                # aren't set on this deployment.
                if hs_tenant and hs_user:
                    try:
                        from wiki_tools import make_wiki_tools

                        search_wiki, read_wiki_page = make_wiki_tools(
                            _strands_tool,
                            tenant_id=hs_tenant,
                            owner_id=hs_user,
                        )
                        tools.append(search_wiki)
                        tools.append(read_wiki_page)
                        logger.info(
                            "Wiki tools registered: search_wiki + read_wiki_page "
                            "tenant=%s user=%s", hs_tenant, hs_user,
                        )
                    except Exception as _wiki_err:
                        logger.warning(
                            "Wiki tools registration failed: %s", _wiki_err,
                        )
            else:
                logger.warning(
                    "Hindsight tools not registered: missing endpoint or bank_id (endpoint=%s bank=%s)",
                    "set" if hs_endpoint else "MISSING",
                    hs_bank or "MISSING",
                )
        except Exception as e:
            logger.warning("Hindsight tools registration failed: %s", e)

    if context_engine_enabled:
        try:
            from strands import tool as _context_engine_tool_decorator
            from context_engine_tool import make_context_engine_tools

            tools.extend(make_context_engine_tools(_context_engine_tool_decorator))
            logger.info(
                "Context Engine tools registered: query_context, query_memory_context, query_wiki_context",
            )
        except Exception as e:
            logger.warning("Context Engine tool registration failed: %s", e)

    # Add file_read tool for skill resource access
    try:
        from strands_tools import file_read as _strands_file_read
        tools.append(_strands_file_read)
        logger.info("strands_tools.file_read added for skill resource access")
    except Exception:
        logger.info("strands_tools.file_read not available")

    # Web Search is an injected built-in tool, not a workspace filesystem skill.
    if web_search_config:
        try:
            from strands import tool as _web_search_tool_decorator
            from web_search_tool import build_web_search_tool

            tools.append(
                build_web_search_tool(
                    strands_tool_decorator=_web_search_tool_decorator,
                    web_search_config=web_search_config,
                    cost_sink=_tool_costs,
                )
            )
            logger.info("Web Search tool registered (total tools: %d)", len(tools))
        except Exception as e:
            logger.warning("Web Search registration failed: %s", e)

    # Send Email is an injected built-in tool, not a workspace filesystem skill.
    if send_email_config:
        try:
            from strands import tool as _send_email_tool_decorator
            from send_email_tool import build_send_email_tool

            tools.append(
                build_send_email_tool(
                    strands_tool_decorator=_send_email_tool_decorator,
                    send_email_config=send_email_config,
                    cost_sink=_tool_costs,
                )
            )
            logger.info("Send Email tool registered (total tools: %d)", len(tools))
        except Exception as e:
            logger.warning("Send Email registration failed: %s", e)

    # Browser Automation is opt-in per template/agent. When policy enables it,
    # register the tool even if dependencies/key are missing so the agent gets
    # a clear provisioning/configuration message instead of silent omission.
    if browser_automation_enabled:
        try:
            from strands import tool as _browser_tool_decorator
            from browser_automation_tool import build_browser_automation_tool

            tools.append(
                build_browser_automation_tool(
                    strands_tool_decorator=_browser_tool_decorator,
                    nova_act_api_key=_nova_act_api_key,
                    cost_sink=_tool_costs,
                    region=AWS_REGION,
                )
            )
            logger.info("Browser Automation tool registered (total tools: %d)", len(tools))
        except Exception as e:
            logger.warning("Browser Automation registration failed: %s", e)

    # 4. Register skill tools (PRD-38: skills as sub-agents)
    # mode: tool  → scripts registered as direct tools on parent
    # mode: agent → skill invocation spins up a sub-agent with its own reasoning loop
    from skill_runner import register_skill_tools
    tool_mode_tools, agent_mode_tools, skill_meta = register_skill_tools(
        skills_config or [],
        workspace_dir=WORKSPACE_DIR,
    )
    tools.extend(tool_mode_tools)
    if tool_mode_tools:
        logger.info("mode:tool skill tools registered on parent: %d", len(tool_mode_tools))

    # 5. Register mode:agent skills as sub-agent @tool functions.
    # Each mode:agent skill becomes a Strands sub-agent with its own prompt (SKILL.md),
    # tools (its scripts), and model (from SKILL.md frontmatter). The orchestrator sees these as
    # callable tools and delegates complex tasks to them.
    sub_agent_usage = []  # Accumulate sub-agent token usage for cost tracking

    def _build_skill_agent_prompt(skill_id: str) -> str:
        """Build a system prompt for a skill sub-agent from SKILL.md + system guardrails."""
        prompt_parts = []

        # Inject current date
        from datetime import datetime
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/Chicago"))
        prompt_parts.append(f"Current date: {now.strftime('%A, %B %d, %Y')} ({now.strftime('%Z')})")

        # System guardrails (same as parent)
        from install_skills import SYSTEM_WORKSPACE_DIR
        for sysfile in ["PLATFORM.md", "GUARDRAILS.md"]:
            syspath = os.path.join(SYSTEM_WORKSPACE_DIR, sysfile)
            if os.path.isfile(syspath):
                try:
                    with open(syspath) as f:
                        prompt_parts.append(f.read().strip())
                except Exception:
                    pass

        # SKILL.md content (safety rules, tool docs, workflows)
        skill_md_path = skill_meta.get(skill_id, {}).get("skill_md_path") or os.path.join(
            WORKSPACE_DIR, "skills", skill_id, "SKILL.md"
        )
        if os.path.isfile(skill_md_path):
            try:
                with open(skill_md_path) as f:
                    content = f.read().strip()
                if content:
                    content = os.path.expandvars(content)
                    prompt_parts.append(content)
            except Exception as e:
                logger.warning("Failed to read SKILL.md for %s: %s", skill_id, e)

        # Token optimization
        prompt_parts.append("""## Token Efficiency Rules

- When calling tools, request ONLY the fields you need. Never use `select *` patterns.
- After receiving tool results, extract and remember only the key data points needed for your response.
- If a tool returns a large JSON response, do NOT repeat the entire response in your reasoning. Summarize the relevant parts.
- Prefer concise, direct answers over verbose explanations.""")

        return "\n\n---\n\n".join(prompt_parts)

    def _extract_genui(agent_instance) -> list:
        """Extract GenUI data from a sub-agent's tool result messages."""
        import json as _json
        genui_items = []
        try:
            _msgs = agent_instance.messages or []
            for msg in _msgs:
                if not isinstance(msg, dict):
                    continue
                for block in msg.get("content", []):
                    if not isinstance(block, dict) or "toolResult" not in block:
                        continue
                    tr_content = block["toolResult"].get("content", [])
                    for c in (tr_content if isinstance(tr_content, list) else []):
                        if isinstance(c, dict) and "text" in c:
                            try:
                                parsed = _json.loads(c["text"])
                                if isinstance(parsed, dict) and "_type" in parsed:
                                    genui_items.append(parsed)
                            except (ValueError, TypeError):
                                pass
        except Exception as e:
            logger.warning("GenUI extraction from sub-agent failed: %s", e)
        return genui_items

    # Capture file_read reference for sub-agent tool access
    _file_read_tool = None
    try:
        from strands_tools import file_read as _fr
        _file_read_tool = _fr
    except Exception:
        pass

    for skill_id, skill_tools in agent_mode_tools.items():
        try:
            meta = skill_meta[skill_id]
            sa_model_id = meta.get("model") or effective_model
            sa_prompt = _build_skill_agent_prompt(skill_id)

            # Give sub-agent file_read for skill resource access
            sa_tools = list(skill_tools)
            if _file_read_tool:
                sa_tools.append(_file_read_tool)

            def make_skill_agent_fn(cfg_model, cfg_prompt, cfg_tools, usage_acc):
                def skill_agent_fn(query: str) -> str:
                    from strands.models import BedrockModel as SubBM
                    try:
                        from strands.models.bedrock import CacheConfig as _CC
                        _sub_cache = _CC(strategy="auto")
                    except ImportError:
                        _sub_cache = None
                    m = SubBM(model_id=cfg_model, region_name=AWS_REGION, streaming=True,
                              **({"cache_config": _sub_cache} if _sub_cache else {}))
                    a = Agent(model=m, system_prompt=cfg_prompt, tools=cfg_tools, callback_handler=None)
                    result = a(query)
                    # Capture sub-agent token usage
                    if result.metrics and result.metrics.accumulated_usage:
                        u = result.metrics.accumulated_usage
                        usage_acc.append({
                            "input_tokens": u.get("inputTokens", 0),
                            "output_tokens": u.get("outputTokens", 0),
                        })

                    # Extract GenUI data from sub-agent's tool results
                    import json as _json
                    genui_items = _extract_genui(a)
                    text_response = str(result)
                    logger.info("Skill sub-agent result: genui=%d items, text_len=%d",
                                len(genui_items), len(text_response))
                    if genui_items:
                        return _json.dumps({
                            "_genui_response": True,
                            "text": text_response,
                            "genui_data": genui_items,
                        })
                    return text_response
                return skill_agent_fn

            _invoke_sub = make_skill_agent_fn(sa_model_id, sa_prompt, sa_tools, sub_agent_usage)

            tool_name = skill_id.replace("-", "_")
            _invoke_sub.__name__ = tool_name
            _invoke_sub.__qualname__ = tool_name
            _invoke_sub.__doc__ = meta.get("description", f"Sub-agent: {skill_id}")

            from strands import tool as _tool_dec
            tool_fn = _tool_dec(_invoke_sub)
            tools.append(tool_fn)
            logger.info("Skill sub-agent registered: %s (mode=agent, model=%s, tools=%d, prompt=%d chars)",
                        tool_name, sa_model_id, len(sa_tools), len(sa_prompt))
        except Exception as e:
            logger.error("Failed to register skill sub-agent %s: %s", skill_id, e)

    if agent_mode_tools:
        logger.info("Total tools: %d (including %d mode:agent skill sub-agents with %d total tools)",
                     len(tools), len(agent_mode_tools),
                     sum(len(t) for t in agent_mode_tools.values()))

    # 6. Load workspace knowledge into parent prompt (PRD-38: workspaces are context, not agents)
    from context_parser import discover_workspaces
    workspace_configs = discover_workspaces(WORKSPACE_DIR)
    if workspace_configs:
        knowledge_sections = []
        for ws in workspace_configs:
            if ws.raw_content.strip():
                knowledge_sections.append(f"## {ws.name}\n\n{ws.raw_content}")
        if knowledge_sections:
            system_prompt += "\n\n---\n\n# Workspace Knowledge\n\n" + "\n\n---\n\n".join(knowledge_sections)
            logger.info("Injected %d workspace knowledge sections into parent prompt", len(knowledge_sections))

    # 7. Built-in delegate tool for ad-hoc reasoning (PRD-38)
    # Allows the orchestrator to spawn a focused sub-agent for complex analysis
    # or multi-step thinking that doesn't fit any defined skill.
    def _make_delegate_fn(cfg_model, usage_acc):
        def delegate(task: str, context: str = "") -> str:
            """Delegate a complex reasoning task to a focused sub-agent.
            Use when you need deep analysis, planning, or multi-step thinking
            that doesn't fit a specific skill. Provide context to set the
            sub-agent's focus."""
            from strands.models import BedrockModel as SubBM
            try:
                from strands.models.bedrock import CacheConfig as _CC
                _sub_cache = _CC(strategy="auto")
            except ImportError:
                _sub_cache = None
            m = SubBM(model_id=cfg_model, region_name=AWS_REGION, streaming=True,
                      **({"cache_config": _sub_cache} if _sub_cache else {}))
            prompt = context if context else "You are a focused reasoning assistant. Think step by step."
            a = Agent(model=m, system_prompt=prompt, tools=[], callback_handler=None)
            result = a(task)
            if result.metrics and result.metrics.accumulated_usage:
                u = result.metrics.accumulated_usage
                usage_acc.append({
                    "input_tokens": u.get("inputTokens", 0),
                    "output_tokens": u.get("outputTokens", 0),
                })
            return str(result)
        return delegate

    _delegate_fn = _make_delegate_fn(effective_model, sub_agent_usage)
    from strands import tool as _tool_dec
    tools.append(_tool_dec(_delegate_fn))
    logger.info("Delegate tool registered (model=%s)", effective_model)

    # Plan §008 U9 (live since plan 2026-04-25-004 U5): path-addressed
    # delegation. Spawns a Bedrock sub-agent rooted at a workspace folder
    # (e.g. "expenses", "support/escalation") with the parent's composed
    # overlay + the folder's local skills. Coexists with the generic
    # `delegate` above — different purposes. The factory's `spawn_fn=None`
    # default resolves to the live Bedrock spawn; tests inject explicit
    # spawn_fn= to keep the seam stub-able.
    _register_delegate_to_workspace_tool(
        tools=tools,
        tool_decorator=_tool_dec,
        skill_meta=skill_meta,
        effective_model=effective_model,
        sub_agent_usage=sub_agent_usage,
    )

    # PRD-31: AgentSkills plugin for progressive skill disclosure.
    # Discovery: injects <available_skills> XML into system prompt
    # Activation: built-in `skills` tool loads SKILL.md on demand
    # Execution: lists resources (scripts/, references/) for file_read
    plugins = []
    try:
        from strands import AgentSkills
        skill_dirs = []
        for meta in skill_meta.values():
            skill_path = meta.get("skill_dir")
            skill_md = meta.get("skill_md_path")
            if skill_path and skill_md and os.path.isfile(skill_md):
                skill_dirs.append(skill_path)
        if skill_dirs:
            plugins.append(AgentSkills(skills=skill_dirs))
            logger.info("AgentSkills plugin created with %d workspace skills", len(skill_dirs))
    except ImportError:
        logger.warning("AgentSkills not available in this strands version")

    # ── MCP client connections ────────────────────────────────────────────
    # Connect to HTTP streaming MCP servers passed in the invocation payload.
    # Each config: {name, url, transport?, auth?: {type, token}, tools?: [...]}
    # Clients are context-managed: __enter__ discovers tools, __exit__ cleans up.
    _mcp_tool_to_server: dict[str, str] = {}  # tool_name → server name (for tracking)
    mcp_clients = _build_mcp_clients(mcp_configs)

    if mcp_clients:
        tools.extend(mcp_clients)
        logger.info("MCP clients added to tool list: %d servers", len(mcp_clients))

    # U12 tenant kill-switch + template-block filter. Applies tenant-wide
    # disables (disabled_builtin_tools) ∪ template-level blocks
    # (blocked_tools) to the registered built-ins. MCP client tools are
    # included in the scan — name-based, so an admin can also disable a
    # misbehaving MCP tool via the same kill-switch list. Tenant wins the
    # intersection; unknown slugs are runtime no-ops with a WARN log.
    from builtin_tool_filter import filter_builtin_tools, log_filter_result
    _filter_result = filter_builtin_tools(
        tools,
        disabled_builtin_tools=disabled_builtin_tools or (),
        template_blocked_tools=template_blocked_tools or (),
    )
    log_filter_result("[builtin-tool-filter]", _filter_result)
    tools = _filter_result.tools

    # U15 pt 3/3 — SI-7 capability-catalog enforcement.
    #
    # Always fetch the catalog's allowed built-in slug set + log a
    # shadow-compare diagnostic so operators can see whether flipping
    # RCM_ENFORCE=true would change this session's tool surface. When
    # RCM_ENFORCE is on AND the fetch succeeded, drop any registered
    # tool whose slug isn't in the catalog — a catalog-missing built-in
    # fails closed. Fail-open otherwise: a network blip on the catalog
    # fetch must not take the agent offline; CloudWatch captures both
    # the fetch failure and the shadow-compare for post-mortem.
    try:
        from capability_catalog import (
            fetch_allowed_slugs,
            filter_by_catalog,
            is_enforcement_enabled,
            log_shadow_compare,
        )
        _rcm_registered_slugs = []
        for _t in tools:
            _tname = getattr(_t, "tool_name", None) or getattr(_t, "__name__", None)
            if isinstance(_tname, str) and _tname:
                _rcm_registered_slugs.append(_tname)
        _rcm_catalog = fetch_allowed_slugs(type_="tool", source="builtin")
        _rcm_enforce = is_enforcement_enabled()
        log_shadow_compare(
            registered_slugs=_rcm_registered_slugs,
            catalog_slugs=_rcm_catalog.slugs,
            enforcement_enabled=_rcm_enforce,
            catalog_ok=_rcm_catalog.ok,
        )
        if _rcm_enforce and _rcm_catalog.ok:
            _rcm_filtered = filter_by_catalog(
                tools, allowed_slugs=_rcm_catalog.slugs,
            )
            if _rcm_filtered.dropped_slugs:
                logger.warning(
                    "[capability-catalog] SI-7 dropped %d tool(s): %s",
                    len(_rcm_filtered.dropped_slugs),
                    list(_rcm_filtered.dropped_slugs),
                )
            tools = _rcm_filtered.tools
        elif _rcm_enforce and not _rcm_catalog.ok:
            # Flag is on but we couldn't fetch — hold behavior rather
            # than accidentally stripping every tool. The shadow log
            # above already recorded the incident.
            logger.warning(
                "[capability-catalog] SI-7 enforcement requested but "
                "catalog fetch failed (%s) — falling back to unfiltered "
                "tool list to avoid a closed-fail storm",
                _rcm_catalog.error,
            )
    except Exception as _rcm_err:
        logger.warning("capability_catalog enforcement step failed: %s", _rcm_err)

    # U15 Resolved Capability Manifest — emit a structured log + best-
    # effort POST to /api/runtime/manifests so admins can see exactly what
    # this session was granted. The persistence path is non-blocking:
    # CloudWatch is the durable observation, the POST is the convenience
    # for admin-UI read-back. Failures are logged + swallowed so manifest
    # infra can never block a session.
    try:
        from capability_manifest import build_and_log as _rcm_build_and_log
        _rcm_skills = [
            {"slug": s.get("slug") or s.get("skillId") or "", "source": s.get("source", "builtin")}
            for s in (skills_config or [])
            if isinstance(s, dict) and (s.get("slug") or s.get("skillId"))
        ]
        _rcm_mcps = [
            {
                "name": m.get("name") or "",
                "url": m.get("url") or "",
                "status": "approved",  # buildMcpConfigs already filters to approved
            }
            for m in (mcp_configs or [])
            if isinstance(m, dict)
        ]
        _rcm_build_and_log(
            session_id=os.environ.get("_SESSION_ID") or os.environ.get("CURRENT_THREAD_ID") or "",
            tenant_id=os.environ.get("TENANT_ID") or "",
            agent_id=os.environ.get("AGENT_ID") or "",
            template_id=os.environ.get("TEMPLATE_ID") or "",
            user_id=os.environ.get("CURRENT_USER_ID") or os.environ.get("USER_ID") or "",
            tools=tools,
            skills=_rcm_skills,
            mcp_servers=_rcm_mcps,
            tenant_disabled_builtins=disabled_builtin_tools or (),
            template_blocked_tools=template_blocked_tools or (),
        )
    except Exception as _rcm_err:
        logger.warning("capability_manifest build_and_log failed: %s", _rcm_err)

    agent = Agent(
        model=bedrock_model,
        system_prompt=system_prompt,
        tools=tools,
        plugins=plugins,
        messages=history if history else None,
        callback_handler=None,
    )

    global _tracker_installed
    if _tracker_available and not _tracker_installed:
        try:
            install_on_session(boto3._get_default_session())
            _tracker_installed = True
        except Exception as e:
            logger.warning("Failed to install Bedrock request tracker: %s", e)
    reset_captured_request_ids()
    try:
        result = agent(current_msg)
    finally:
        # Clean up MCP client connections (must happen even on error)
        for _mcp_c in mcp_clients:
            try:
                if hasattr(_mcp_c, '_session') and _mcp_c._session:
                    _mcp_c.stop()
            except Exception as _mcp_err:
                logger.warning("MCP client cleanup error: %s", _mcp_err)
        if mcp_clients:
            logger.info("MCP clients cleaned up: %d", len(mcp_clients))
        # Sandbox execute_code session teardown (plan Unit 7 R-Q6).
        # Log-and-continue on failure — AgentCore's 5-min session timeout
        # is the backstop. Session id lives on _sb_state inside the tool
        # closure (call-frame-local), which goes out of scope here.
        if _sandbox_cleanup_fn is not None:
            try:
                import asyncio as _a
                _a.get_event_loop().run_until_complete(_sandbox_cleanup_fn())
            except Exception as _sb_err:
                logger.warning("sandbox cleanup failed: %s", _sb_err)
    bedrock_request_ids = get_captured_request_ids()

    # 5. Extract response and usage
    response_text = str(result)
    usage = result.metrics.accumulated_usage if result.metrics else {}
    input_tokens = usage.get("inputTokens", 0)
    output_tokens = usage.get("outputTokens", 0)

    # Log sub-agent token usage for observability (but don't add to parent totals —
    # parent's accumulated_usage already reflects its own cost, and sub-agent costs
    # are tracked separately via CloudWatch invocation logs).
    if sub_agent_usage:
        sa_total_in = sum(u.get("input_tokens", 0) for u in sub_agent_usage)
        sa_total_out = sum(u.get("output_tokens", 0) for u in sub_agent_usage)
        logger.info("Sub-agent token usage: %d entries, input=%d output=%d (tracked separately)",
                     len(sub_agent_usage), sa_total_in, sa_total_out)

    # 6. Extract tool calls from conversation history (with per-tool input/output)
    tools_called = []
    tool_invocations = []
    # Build set of sub-agent tool names for type tagging (PRD-38: mode:agent skills)
    sub_agent_tool_names = {sid.replace("-", "_") for sid in agent_mode_tools}

    try:
        pending_tools = {}  # tool_use_id → invocation dict
        seq = 0
        for msg in (agent.messages or []):
            if not isinstance(msg, dict):
                continue
            for block in (msg.get("content") or []):
                if not isinstance(block, dict):
                    continue
                if "toolUse" in block:
                    tu = block["toolUse"]
                    tool_name = tu.get("name", "")
                    tool_use_id = tu.get("toolUseId", "")
                    tool_input = tu.get("input", {})

                    if tool_name and tool_name not in tools_called:
                        tools_called.append(tool_name)

                    # Build input preview (truncate for storage)
                    if isinstance(tool_input, str):
                        input_preview = tool_input[:5000]
                    elif isinstance(tool_input, dict):
                        # For sub-agents, input is {"query": "..."} — extract the query
                        if "query" in tool_input:
                            input_preview = str(tool_input["query"])[:5000]
                        else:
                            import json as _json
                            input_preview = _json.dumps(tool_input, default=str)[:5000]
                    else:
                        input_preview = str(tool_input)[:5000]

                    # Classify tool type: sub_agent, mcp_server (external MCP), or mcp_tool (script/built-in)
                    if tool_name in sub_agent_tool_names:
                        tool_type = "sub_agent"
                    elif tool_name in _mcp_tool_to_server:
                        tool_type = "mcp_server"
                    else:
                        tool_type = "mcp_tool"

                    invocation = {
                        "sequence": seq,
                        "tool_name": tool_name,
                        "type": tool_type,
                        "input_preview": input_preview,
                        "output_preview": "",
                        "status": "pending",
                    }
                    # Tag external MCP tool calls with their server name for UI display
                    if tool_name in _mcp_tool_to_server:
                        invocation["mcp_server"] = _mcp_tool_to_server[tool_name]
                    pending_tools[tool_use_id] = invocation
                    tool_invocations.append(invocation)
                    seq += 1

                if "toolResult" in block:
                    tr = block["toolResult"]
                    tool_use_id = tr.get("toolUseId", "")
                    if tool_use_id in pending_tools:
                        inv = pending_tools[tool_use_id]
                        inv["status"] = tr.get("status", "success")
                        # Extract output preview from content blocks
                        content = tr.get("content", [])
                        if isinstance(content, list):
                            text_parts = []
                            for c in content:
                                if isinstance(c, dict) and "text" in c:
                                    text_parts.append(str(c["text"]))
                                elif isinstance(c, str):
                                    text_parts.append(c)
                            full_output = "\n".join(text_parts)
                            inv["output_preview"] = full_output[:5000]
                            # Capture GenUI data: either direct _type JSON or _genui_response from sub-agent
                            # Inject _source so GenUI cards can be refreshed without re-invoking the LLM
                            try:
                                import json as _json
                                parsed = _json.loads(full_output)
                                if isinstance(parsed, dict):
                                    # Inject _source for MCP tool calls (not sub-agents)
                                    _source = None
                                    if inv.get("type") in ("mcp_tool", "mcp_server"):
                                        preview = inv.get("input_preview", "")
                                        _source = {
                                            "tool": inv.get("tool_name", ""),
                                            "params": _json.loads(preview) if preview.startswith("{") else {},
                                        }
                                    if "_type" in parsed:
                                        if _source:
                                            parsed["_source"] = _source
                                        inv["genui_data"] = [parsed]
                                    elif parsed.get("_genui_response") and parsed.get("genui_data"):
                                        genui_items = parsed["genui_data"]
                                        if _source:
                                            for gi in (genui_items if isinstance(genui_items, list) else [genui_items]):
                                                if isinstance(gi, dict):
                                                    gi["_source"] = _source
                                        inv["genui_data"] = genui_items
                            except (ValueError, TypeError):
                                pass
                        elif isinstance(content, str):
                            inv["output_preview"] = content[:5000]
    except Exception as e:
        logger.warning("Tool invocation extraction failed: %s", e)

    # Detect guardrail blocks
    guardrail_block = None
    if guardrail_config:
        blocked_msg = "This request was blocked by a content policy."
        # Method 1: Strands returns the blockedInputMessaging/blockedOutputsMessaging
        # text directly with 0 tokens when a guardrail fires
        if response_text.strip() == blocked_msg and input_tokens == 0 and output_tokens == 0:
            guardrail_block = {
                "blocked": True, "type": "INPUT", "action": "BLOCKED",
                "topics": [], "filters": {}, "raw": {},
            }
            logger.warning("Guardrail block detected via blocked message text (input filter)")

        # Method 2: Check conversation history for guardrail stop reason
        if not guardrail_block:
            try:
                for msg in (agent.messages or []):
                    if not isinstance(msg, dict):
                        continue
                    stop_reason = msg.get("stopReason") or msg.get("stop_reason")
                    if stop_reason and str(stop_reason).lower() == "guardrail":
                        guardrail_block = {
                            "blocked": True, "type": "OUTPUT", "action": "BLOCKED",
                            "topics": [], "filters": {}, "raw": {},
                        }
                        logger.warning("Guardrail block detected in message stop reason")
                        break
                    for block in (msg.get("content") or []):
                        if isinstance(block, dict) and "guard" in str(block.get("type", "")).lower():
                            guardrail_block = {
                                "blocked": True, "type": block.get("direction", "OUTPUT").upper(),
                                "action": block.get("action", "BLOCKED"),
                                "topics": block.get("topics", []), "filters": block.get("filters", {}),
                                "raw": block,
                            }
                            logger.warning("Guardrail block detected in content block")
                            break
                    if guardrail_block:
                        break
            except Exception as e:
                logger.warning("Guardrail block detection failed: %s", e)

    # PRD-41B Phase 7 item 2: drain captured Hindsight retain/reflect usage
    # for this invoke. The list is populated by the monkey-patch installed
    # by hindsight_usage_capture.install() at tool-registration time. Empty
    # list when the agent didn't call hindsight_retain or hindsight_reflect.
    hindsight_usage: list = []
    try:
        import hindsight_usage_capture
        hindsight_usage = hindsight_usage_capture.drain()
    except Exception as hu_err:
        logger.warning("hindsight_usage_capture drain failed: %s", hu_err)

    logger.info("Strands agent complete: response_len=%d, input_tokens=%d, output_tokens=%d, bedrock_requests=%d, tools=%s guardrail_blocked=%s hindsight_usage=%d",
                len(response_text), input_tokens, output_tokens, len(bedrock_request_ids), tools_called,
                bool(guardrail_block), len(hindsight_usage))

    usage_dict = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "bedrock_request_ids": bedrock_request_ids,
        "tools_called": tools_called,
        "tool_invocations": tool_invocations,
        "hindsight_usage": hindsight_usage,
    }
    if guardrail_block:
        usage_dict["guardrail_block"] = guardrail_block

    return response_text, usage_dict


def _error_response(message: str) -> dict:
    return {
        "id": f"chatcmpl_{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "strands-agent",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": message},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _audit_response(tenant_id: str, response_text: str, allowed_tools: list) -> None:
    """Scan response for tool usage and log any violations."""
    tool_pattern = r'\b(shell|browser|file_write|code_execution|install_skill|load_extension|eval)\b'
    matches = __import__("re").findall(tool_pattern, response_text, __import__("re").IGNORECASE)
    if not matches:
        return
    for tool in set(t.lower() for t in matches):
        if tool not in allowed_tools:
            log_permission_denied(
                tenant_id=tenant_id,
                tool_name=tool,
                cedar_decision="RESPONSE_AUDIT",
                request_id=None,
            )
            logger.warning("AUDIT: blocked tool '%s' in response tenant_id=%s", tool, tenant_id)


def _inject_skill_env(skills_config: list) -> list:
    """Fetch credentials from Secrets Manager + envOverrides, inject as env vars."""
    injected = []
    try:
        sm = boto3.client("secretsmanager", region_name=AWS_REGION)
    except Exception as e:
        logger.warning("Failed to create Secrets Manager client: %s", e)
        sm = None
    for skill in skills_config:
        ref = skill.get("secretRef", "")
        if ref and sm:
            try:
                resp = sm.get_secret_value(SecretId=ref)
                data = json.loads(resp["SecretString"])
                if data.get("type") == "skillEnv":
                    for k, v in data.get("env", {}).items():
                        os.environ[k] = v
                        injected.append(k)
                    os.environ["SKILL_SECRET_REF"] = ref
                    injected.append("SKILL_SECRET_REF")
            except Exception as e:
                logger.warning("skill secret fetch failed %s: %s", ref, e)
        env_overrides = skill.get("envOverrides")
        if env_overrides and isinstance(env_overrides, dict):
            for k, v in env_overrides.items():
                os.environ[k] = str(v)
                injected.append(k)
            logger.info("Injected %d envOverrides for skill %s", len(env_overrides), skill.get("skillId", "?"))
    return injected


def _cleanup_skill_env(keys: list):
    """Remove injected skill env vars to prevent leakage between requests."""
    for k in keys:
        os.environ.pop(k, None)


def _execute_agent_turn(payload: dict) -> dict:
    """Run one Strands agent turn for a chat-invoke-shaped payload.

    Shared execution path between the chat handler (AgentCoreHandler.do_POST
    default-kind branch) and the ``kind=run_skill`` dispatcher
    (run_skill_dispatch.dispatch_run_skill). Both construct a payload in the
    same shape -- per-agent config resolved by
    ``resolveAgentRuntimeConfig`` plus per-turn fields (message, messages_
    history, user_id, thread_id, trigger_channel) -- and expect back the
    response text plus strands usage.

    Extracted for plan docs/plans/2026-04-24-008-feat-skill-run-dispatcher-
    plan.md §U2 so the dispatcher does not re-implement the ~170-line
    prologue (skill install, workspace bootstrap, skill-env injection, eval
    span attrs, messages + system_prompt build, _call_strands_agent).

    Caller responsibilities:
      * ``invocation_env.apply_invocation_env`` before calling, with cleanup
        in a ``finally``. This helper sets per-skill env vars
        (``_inject_skill_env``) but not the core invocation identity.
      * Post-call side effects: audit, retain, log_agent_invocation,
        HTTP response formatting, skill_runs writeback, etc. This helper
        does NOT format the chat-completion response shape or call the
        auto-retain pipeline.
      * Guardrail-exception handling: if ``_call_strands_agent`` raises an
        exception whose message contains "guardrail" or "content policy"
        with a guardrail_config in the payload, the caller is expected to
        classify that as a blocked response rather than an error.

    Cleanup handled inside the helper (via ``finally``):
      * ``detach_eval_context`` on the span token.
      * ``_cleanup_skill_env`` on injected skill env vars.

    Returns a dict with:
      * ``response_text`` (str) -- the model's final answer.
      * ``strands_usage`` (dict) -- token counts, request ids, tool costs,
        hindsight_usage, optional guardrail_block.
      * ``duration_ms`` (int) -- wall-clock time for the agent turn.
      * ``invocation_tool_costs`` (list) -- drained ``_tool_costs`` snapshot.

    Raises whatever ``_call_strands_agent`` raises. Caller must
    ``try/except`` around it.
    """
    workspace_tenant_id = payload.get("workspace_tenant_id") or ""
    assistant_id = payload.get("assistant_id") or ""
    tenant_slug = payload.get("tenant_slug") or ""
    instance_id = payload.get("instance_id") or ""
    agent_name = payload.get("agent_name") or ""
    human_name = payload.get("human_name") or ""
    message = validate_message(payload.get("message", ""))
    trigger_channel = payload.get("trigger_channel") or ""
    context_profile_name = payload.get("context_profile") or ""
    request_model = payload.get("model", "")
    skills_config = payload.get("skills")
    knowledge_bases_config = payload.get("knowledge_bases")
    guardrail_config = payload.get("guardrail_config")
    mcp_configs = payload.get("mcp_configs") or []
    web_search_config = payload.get("web_search_config")
    send_email_config = payload.get("send_email_config")
    context_engine_enabled = bool(payload.get("context_engine_enabled"))
    thread_metadata = payload.get("thread_metadata") or {}
    workflow_skill = payload.get("workflow_skill")
    disabled_builtin_tools = payload.get("disabled_builtin_tools") or []
    template_blocked_tools = payload.get("blocked_tools") or []
    browser_automation_enabled = bool(payload.get("browser_automation_enabled"))
    tenant_id_for_audit = (
        payload.get("sessionId") or payload.get("tenant_id") or "unknown"
    )
    ticket_id = payload.get("thread_id") or payload.get("ticket_id") or ""

    # Set per-payload env (caller already ran apply_invocation_env for
    # identity; these are orthogonal — workspace / composer / hindsight).
    workspace_bucket = payload.get("workspace_bucket") or ""
    _apply_workspace_bucket_env(workspace_bucket)
    thinkwork_api_url = payload.get("thinkwork_api_url") or ""
    if thinkwork_api_url:
        os.environ["THINKWORK_API_URL"] = thinkwork_api_url
    thinkwork_api_secret = payload.get("thinkwork_api_secret") or ""
    if thinkwork_api_secret:
        os.environ["THINKWORK_API_SECRET"] = thinkwork_api_secret
        os.environ["API_AUTH_SECRET"] = thinkwork_api_secret
    hindsight_endpoint = payload.get("hindsight_endpoint") or ""
    if hindsight_endpoint:
        os.environ["HINDSIGHT_ENDPOINT"] = hindsight_endpoint
    if instance_id:
        os.environ["_INSTANCE_ID"] = instance_id
    if assistant_id:
        os.environ["_ASSISTANT_ID"] = assistant_id

    # Sync workspace from S3.
    _ensure_workspace_ready(
        workspace_tenant_id,
        assistant_id,
        skills_config,
        tenant_slug=tenant_slug,
        instance_id=instance_id,
        agent_name=agent_name,
        human_name=human_name,
    )

    injected_env_keys = _inject_skill_env(skills_config) if skills_config else []

    from eval_span_attrs import attach_eval_context, detach_eval_context
    eval_ctx_token = attach_eval_context(
        session_id=tenant_id_for_audit,
        tenant_id=workspace_tenant_id,
        agent_id=assistant_id,
        thread_id=ticket_id,
    )

    try:
        # Build messages from history + current.
        messages = []
        history_payload = payload.get("messages_history") or []
        if isinstance(history_payload, list):
            for hmsg in history_payload:
                if not isinstance(hmsg, dict):
                    continue
                role = hmsg.get("role")
                content = hmsg.get("content")
                if (
                    role in ("user", "assistant")
                    and isinstance(content, str)
                    and content
                ):
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": message})

        # Resolve profile (workspace_files hint or fallback to ROUTER.md).
        harness_files = payload.get("workspace_files")
        profile = None
        effective_skills = skills_config
        if harness_files and isinstance(harness_files, list):
            from router_parser import ContextProfile
            profile = ContextProfile(load=harness_files)
        else:
            from router_parser import resolve_profile
            router_path = os.path.join(WORKSPACE_DIR, "ROUTER.md")
            profile = resolve_profile(
                router_path,
                channel=trigger_channel,
                context_profile=context_profile_name or None,
            )

        has_workspace_map = os.path.isfile(os.path.join(WORKSPACE_DIR, "AGENTS.md"))
        parent_kb_config = (
            None if has_workspace_map else knowledge_bases_config
        )
        system_prompt = _build_system_prompt(
            effective_skills, parent_kb_config, profile=profile
        )

        external_block = format_external_task_context(thread_metadata)
        if external_block:
            system_prompt += "\n\n---\n\n" + external_block

        workflow_block = format_workflow_skill_context(workflow_skill)
        if workflow_block:
            system_prompt += "\n\n---\n\n" + workflow_block

        if knowledge_bases_config and not has_workspace_map:
            try:
                kb_context = _retrieve_kb_context(knowledge_bases_config, message)
                if kb_context:
                    system_prompt += "\n\n---\n\n" + kb_context
            except Exception as e:
                logger.warning("KB retrieval failed: %s", e)

        start_ms = int(time.time() * 1000)
        response_text, strands_usage = _call_strands_agent(
            system_prompt,
            messages,
            model=request_model,
            skills_config=skills_config,
            guardrail_config=guardrail_config,
            mcp_configs=mcp_configs if mcp_configs else None,
            disabled_builtin_tools=disabled_builtin_tools,
            template_blocked_tools=template_blocked_tools,
            web_search_config=web_search_config,
            send_email_config=send_email_config,
            context_engine_enabled=context_engine_enabled,
            browser_automation_enabled=browser_automation_enabled,
        )
        duration_ms = int(time.time() * 1000) - start_ms

        # Drain per-invocation tool costs. The chat handler also clears this
        # list on guardrail failure inside its except block; our caller
        # handles that case by relying on the outer except re-clearing.
        invocation_tool_costs = list(_tool_costs)
        _tool_costs.clear()

        return {
            "response_text": response_text,
            "strands_usage": strands_usage,
            "duration_ms": duration_ms,
            "invocation_tool_costs": invocation_tool_costs,
        }
    finally:
        detach_eval_context(eval_ctx_token)
        _cleanup_skill_env(injected_env_keys)


class AgentCoreHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: A002
        logger.info(fmt, *args)

    def do_GET(self):
        if self.path == "/ping":
            self._respond(200, {"status": "Healthy", "time_of_last_update": int(time.time())})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/invocations":
            self._respond(404, {"error": "not found"})
            return

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, {"error": "invalid json"})
            return

        logger.info("Raw payload keys: %s", list(payload.keys()))

        # kind="run_skill" envelope — skill-run dispatch path. The TS
        # /api/skills/start handler fires this shape via agentcore-invoke
        # when a caller (chat dispatcher, admin catalog, scheduled job,
        # webhook) wants to run a skill. Handled synchronously within
        # this invocation; terminal state is POSTed back to /api/skills/
        # complete before we respond to the caller.
        if payload.get("kind") == "run_skill":
            from run_skill_dispatch import dispatch_run_skill
            # Set the per-invocation env aliases (TENANT_ID / AGENT_ID /
            # USER_ID / CURRENT_USER_ID / CURRENT_THREAD_ID) so the
            # dispatcher sees the same identity the normal path would.
            # The run_skill envelope uses camelCase keys — translate before
            # applying. Cleared in `finally` so the warm container does
            # not leak identity into the next invocation.
            scope = payload.get("scope") or {}
            invocation_env_keys = invocation_env.apply_invocation_env({
                "workspace_tenant_id": payload.get("tenantId")
                    or scope.get("tenantId")
                    or "",
                "assistant_id": payload.get("agentId")
                    or scope.get("agentId")
                    or "",
                "user_id": payload.get("invokerUserId")
                    or scope.get("invokerUserId")
                    or "",
                "thread_id": payload.get("threadId")
                    or scope.get("threadId")
                    or "",
            })
            try:
                result = asyncio.run(dispatch_run_skill(payload))
                self._respond(200, result)
            except Exception as e:
                logger.exception("run_skill: dispatch crashed")
                self._respond(500, {"error": f"run_skill dispatch crashed: {e}"})
            finally:
                invocation_env.cleanup_invocation_env(invocation_env_keys)
            return

        tenant_id = payload.get("sessionId") or payload.get("tenant_id") or "unknown"
        ticket_id = payload.get("thread_id") or payload.get("ticket_id") or ""
        assistant_id = payload.get("assistant_id") or ""
        user_id = payload.get("user_id") or ""
        workspace_tenant_id = payload.get("workspace_tenant_id") or ""
        tenant_slug = payload.get("tenant_slug") or ""
        instance_id = payload.get("instance_id") or ""
        logger.info("Workspace params: tenant_slug=%s instance_id=%s workspace_tenant_id=%s assistant_id=%s",
                    tenant_slug, instance_id, workspace_tenant_id, assistant_id)
        message = validate_message(payload.get("message", ""))
        use_memory = payload.get("use_memory", False) and bool(ticket_id)
        logger.info("use_memory=%s", use_memory)
        request_model = payload.get("model", "")
        guardrail_config = payload.get("guardrail_config")
        mcp_configs = payload.get("mcp_configs") or []
        if mcp_configs:
            logger.info("MCP configs received: %d servers (%s)",
                        len(mcp_configs),
                        ", ".join(c.get("name", c.get("url", "?")) for c in mcp_configs))

        # Per-invocation identity env. Sandbox fields ride the chat payload
        # when the caller's pre-flight returned status=ready; they would be
        # absent from a run_skill envelope. Returned key list is cleared in
        # the `finally` so warm containers don't leak identity across
        # invocations. CURRENT_USER_ID is only set when user_id is truthy —
        # a missing invoker must be distinguishable from an empty-string
        # one so the admin skill's R15 "no invoker" refusal triggers.
        invocation_env_keys = invocation_env.apply_invocation_env({
            "workspace_tenant_id": workspace_tenant_id,
            "assistant_id": assistant_id,
            "user_id": user_id,
            "thread_id": ticket_id,
            "sandbox_interpreter_id": payload.get("sandbox_interpreter_id") or "",
            "sandbox_environment": payload.get("sandbox_environment") or "",
        })

        try:
            start_ms = int(time.time() * 1000)
            try:
                turn_result = _execute_agent_turn(payload)
                response_text = turn_result["response_text"]
                strands_usage = turn_result["strands_usage"]
                duration_ms = turn_result["duration_ms"]
                invocation_tool_costs = turn_result["invocation_tool_costs"]

                input_tokens = strands_usage.get("input_tokens", 0)
                output_tokens = strands_usage.get("output_tokens", 0)

                result = {
                    "id": f"chatcmpl_{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": request_model or DEFAULT_MODEL,
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": response_text},
                        "finish_reason": "stop",
                    }],
                    "usage": {
                        "prompt_tokens": input_tokens,
                        "completion_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                    },
                    "bedrock_request_ids": strands_usage.get("bedrock_request_ids", []),
                    "tool_costs": invocation_tool_costs,
                    "tools_called": strands_usage.get("tools_called", []),
                    "tool_invocations": strands_usage.get("tool_invocations", []),
                    # PRD-41B Phase 7 item 2: per-call Hindsight Bedrock usage
                    # captured from retain/reflect responses by the monkey-patch
                    # in hindsight_usage_capture.py. chat-agent-invoke parses
                    # this and writes one cost_events row per entry.
                    "hindsight_usage": strands_usage.get("hindsight_usage", []),
                }

                # Attach guardrail block info if present
                if strands_usage.get("guardrail_block"):
                    result["guardrail_block"] = strands_usage["guardrail_block"]

                # Audit the response for tool usage
                try:
                    profile = read_permission_profile(tenant_id)
                    allowed = profile.get("tools", ["web_search"])
                except Exception:
                    allowed = ["web_search"]
                _audit_response(tenant_id, response_text, allowed)

                # Auto-retain this turn through the API's normalized memory
                # layer. The memory-retain Lambda invokes the active
                # engine's adapter.retainTurn() — Hindsight POSTs the turn
                # to /memories for its own LLM extraction; AgentCore fires
                # CreateEvent so the background semantic / preferences /
                # summaries / episodes strategies pick it up. Engine
                # selection lives entirely in the API layer; the runtime is
                # engine-agnostic. Async invoke (InvocationType=Event), so
                # this never blocks the response. Best-effort — failures
                # log and move on.
                try:
                    import api_memory_client
                    api_memory_client.retain_turn_pair(
                        thread_id=ticket_id,
                        user_message=message,
                        assistant_response=response_text,
                        tenant_id=tenant_id,
                    )
                except Exception as retain_err:
                    logger.warning("auto-retain failed thread=%s: %s",
                                   ticket_id, retain_err)

                log_agent_invocation(tenant_id=tenant_id, tools_used=["strands_agent"],
                                    duration_ms=duration_ms, status="success")
                self._respond(200, result)

            except Exception as e:
                duration_ms = int(time.time() * 1000) - start_ms
                err_str = str(e).lower()

                if guardrail_config and ("guardrail" in err_str or "content policy" in err_str):
                    logger.warning("Guardrail exception detected tenant_id=%s: %s", tenant_id, e)
                    _tool_costs.clear()
                    block_result = {
                        "id": f"chatcmpl_{int(time.time())}",
                        "object": "chat.completion",
                        "created": int(time.time()),
                        "model": request_model or DEFAULT_MODEL,
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": "This request was blocked by a content policy."}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                        "guardrail_block": {"blocked": True, "type": "INPUT", "action": "BLOCKED", "topics": [], "filters": {}, "raw": {"exception": str(e)}},
                    }
                    log_agent_invocation(tenant_id=tenant_id, tools_used=[], duration_ms=duration_ms, status="guardrail_blocked")
                    self._respond(200, block_result)
                else:
                    log_agent_invocation(tenant_id=tenant_id, tools_used=[], duration_ms=duration_ms, status="error")
                    logger.error("Strands agent invocation failed tenant_id=%s error=%s", tenant_id, e)
                    self._respond(500, _error_response(str(e)))
        finally:
            invocation_env.cleanup_invocation_env(invocation_env_keys)

    def do_DELETE(self):
        self._respond(405, {"error": "stateless — no sessions to terminate"})

    def _respond(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    # Build provenance — emit the commit SHA + build time the image was
    # stamped with by deploy.yml. When a warm runtime holds onto a stale
    # image (AgentCore doesn't auto-repull), a single grep for
    # THINKWORK_BUILD in CloudWatch answers which commit is actually live.
    _git_sha = os.environ.get("THINKWORK_GIT_SHA", "unknown")
    _build_time = os.environ.get("THINKWORK_BUILD_TIME", "unknown")
    logger.info("THINKWORK_BUILD git_sha=%s build_time=%s", _git_sha, _build_time)

    # Register the eval-attribution span processor so every span carries
    # session.id / tenant.id / agent.id / thread.id from baggage. Logs a
    # warning if the global TracerProvider isn't an SDK provider yet, in
    # which case spans go un-attributed (eval-runner falls back to trace
    # ID correlation).
    try:
        from eval_span_attrs import register_processor
        if register_processor():
            logger.info("Registered EvalAttrSpanProcessor on TracerProvider")
        else:
            logger.warning("EvalAttrSpanProcessor not registered — TracerProvider lacks add_span_processor")
    except Exception as e:
        logger.warning("Failed to register EvalAttrSpanProcessor: %s", e)

    # Load Nova Act API key from SSM. Browser Automation still registers a
    # structured unavailable tool when this is absent and policy enables it.
    global _nova_act_api_key
    try:
        from browser_automation_tool import load_nova_act_key
        _nova_act_api_key = load_nova_act_key(region=AWS_REGION)
    except Exception as e:
        logger.warning("Failed to load Nova Act API key: %s", e)
        _nova_act_api_key = ""

    # Download global skill catalog from S3
    install_skills()

    # Download system workspace files (platform rules, guardrails) — once per container
    from install_skills import install_system_workspace
    install_system_workspace()

    port = int(os.environ.get("PORT", 8080))
    server = HTTPServer(("0.0.0.0", port), AgentCoreHandler)
    logger.info("Agent Container listening on port %d (Strands Agent SDK runtime)", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
