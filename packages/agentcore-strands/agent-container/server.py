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

_workspace_loaded_key = None

# The personality-template constant used to drive _fetch_memory_templates
# / _bootstrap_personality_files. Those functions are gone (Unit 7) —
# everything flows through the composer now. The list lives in
# @thinkwork/workspace-defaults' CANONICAL_FILE_NAMES on the server side.

# ── Nova Act browser tool ────────────────────────────────────────────────────
# Loads API key from SSM at startup. The @tool decorated function is passed
# to the Strands Agent alongside MCP clients.

_nova_act_api_key: str = ""
_tool_costs: list[dict] = []  # Accumulated per-invocation tool costs

def _load_nova_act_key() -> str:
    """Load Nova Act API key. Tries env var, then multiple SSM paths."""
    key = os.environ.get("NOVA_ACT_API_KEY", "")
    if key:
        logger.info("Nova Act API key loaded from env var")
        return key
    # Try SSM with both stage names
    ssm = boto3.client("ssm", region_name=AWS_REGION)
    for stage in [os.environ.get("STACK_NAME", "dev"), "ericodom", "main"]:
        param = f"/thinkwork/{stage}/nova-act-api-key"
        try:
            resp = ssm.get_parameter(Name=param, WithDecryption=True)
            key = resp.get("Parameter", {}).get("Value", "")
            if key:
                logger.info("Nova Act API key loaded from SSM: %s", param)
                return key
        except Exception:
            continue
    logger.warning("Nova Act API key not found in env or SSM")
    return ""

try:
    from strands import tool as strands_tool
    from bedrock_agentcore.tools.browser_client import browser_session
    from nova_act import NovaAct

    @strands_tool
    def _browse_website(url: str, task: str) -> str:
        """Navigate to a website and perform a task using an AI-powered browser.

        Use this to check restaurant availability, fill forms, extract data,
        or interact with any website that requires clicking, typing, or reading
        dynamic content. The browser handles complex UIs automatically.

        Args:
            url: The URL to navigate to (e.g., https://resy.com/cities/austin-tx/venues/lenoir)
            task: What to do on the page (e.g., "Check availability for 2 people on March 26 around 7pm. Return available time slots.")

        Returns:
            The result of the browser interaction
        """
        logger.info("browse_website called: url=%s task=%s", url, task[:100])
        start_time = time.time()
        try:
            with browser_session(AWS_REGION) as client:
                ws_url, headers = client.generate_ws_headers()
                logger.info("Browser session started, connecting Nova Act...")
                with NovaAct(
                    cdp_endpoint_url=ws_url,
                    cdp_headers=headers,
                    nova_act_api_key=_nova_act_api_key,
                    starting_page=url,
                ) as nova:
                    result = nova.act_get(task, schema={"type": "string"})
                    response = str(result.response) if result.response else ""
                    duration_sec = time.time() - start_time
                    # Nova Act: $4.75/agent hour = ~$0.0792/min
                    # AgentCore Browser: ~$0.001/min
                    nova_cost = (duration_sec / 60) * 0.0792
                    browser_cost = (duration_sec / 60) * 0.001
                    total_cost = nova_cost + browser_cost
                    _tool_costs.append({
                        "provider": "nova_act",
                        "event_type": "nova_act_browse",
                        "amount_usd": round(total_cost, 6),
                        "duration_ms": int(duration_sec * 1000),
                        "metadata": {"url": url, "task": task[:100], "response_len": len(response)},
                    })
                    logger.info("Nova Act completed: response_len=%d duration=%.1fs cost=$%.4f",
                                len(response), duration_sec, total_cost)
                    if not response or response == "None":
                        return f"Browser navigated to {url} but could not extract the requested information."
                    return response
        except Exception as e:
            duration_sec = time.time() - start_time
            _tool_costs.append({
                "provider": "nova_act",
                "event_type": "nova_act_browse",
                "amount_usd": round((duration_sec / 60) * 0.0792, 6),
                "duration_ms": int(duration_sec * 1000),
                "metadata": {"url": url, "error": str(e)[:200]},
            })
            logger.error("browse_website error: %s: %s", type(e).__name__, e, exc_info=True)
            return f"Browser automation error: {e}"

    logger.info("Nova Act browse_website tool defined")
except ImportError as e:
    logger.warning("Nova Act not available (missing dependency): %s", e)
    _browse_website = None


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

from workspace_composer_client import (
    compute_fingerprint,
    fetch_composed_workspace,
    write_composed_to_dir,
)


# Cache the hash of the last composed-list result so we skip rewriting
# /tmp/workspace on warm reuse when nothing changed. Composer caching +
# this client-side short-circuit keep mass-wakeup bootstrap cost bounded
# (see plan's project_enterprise_onboarding_scale memory).
_composed_fingerprint: str | None = None


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

    # PRD-40: Inject execution:context skills directly into the system prompt.
    # These skills have SKILL.md instructions that must be always-on, not on-demand.
    if skills_config:
        import re
        for skill in skills_config:
            sid = skill.get("skillId", "")
            skill_yaml_path = os.path.join("/tmp/skills", sid, "skill.yaml")
            skill_md_path = os.path.join("/tmp/skills", sid, "SKILL.md")
            if os.path.isfile(skill_yaml_path) and os.path.isfile(skill_md_path):
                try:
                    with open(skill_yaml_path) as yf:
                        yaml_text = yf.read()
                    # Simple check for execution: context without full YAML parser
                    if re.search(r"^\s*execution:\s*context\s*$", yaml_text, re.MULTILINE):
                        with open(skill_md_path) as mf:
                            md_content = mf.read().strip()
                        if md_content:
                            parts.append(md_content)
                            logger.info("Injected context skill %s SKILL.md (%d chars)", sid, len(md_content))
                except Exception as e:
                    logger.warning("Failed to inject context skill %s: %s", sid, e)

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
    """Fetch the composed workspace from /api/workspaces/files and write it
    to /tmp/workspace. No S3 reads, no S3 writes, no local substitution.

    Falls back to the legacy direct-S3 sync only when THINKWORK_API_URL /
    API_AUTH_SECRET aren't set (early boot or misconfigured deploy). Under
    normal operation every file comes from the composer — that's what
    closes the "first boot forks every agent's S3 state" regression.
    """
    global _workspace_loaded_key, _composed_fingerprint

    # tenant_slug / instance_id are the legacy fallback fields; the composer
    # itself only needs tenant UUID + agent UUID.
    if not workspace_tenant_id or not assistant_id:
        os.makedirs(WORKSPACE_DIR, exist_ok=True)
        return

    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )

    os.makedirs(WORKSPACE_DIR, exist_ok=True)

    if not api_url or not api_secret:
        # No composer URL / secret → legacy direct-S3 sync. This path stays
        # until every deploy env has THINKWORK_API_URL + API_AUTH_SECRET
        # plumbed through (safety net for transitional deploys).
        ws_tenant = tenant_slug or workspace_tenant_id
        ws_instance = instance_id or assistant_id
        if not ws_tenant or not ws_instance:
            return
        try:
            from install_skills import install_workspace
            install_workspace(ws_tenant, ws_instance)
            logger.warning(
                "workspace_sync action=legacy_s3 (no composer URL/secret)"
            )
        except Exception as e:
            logger.warning("workspace_sync legacy S3 failed: %s", e)
        return

    t_sync = time.time()
    try:
        files = fetch_composed_workspace(
            tenant_id=workspace_tenant_id,
            agent_id=assistant_id,
            api_url=api_url,
            api_secret=api_secret,
        )
    except Exception as e:
        logger.warning("workspace_sync composer fetch failed: %s", e)
        return

    # Client-side fingerprint skip: if composer returns the same set of
    # {path, sha256} as last time, don't rewrite /tmp/workspace.
    fingerprint = compute_fingerprint(files)
    if fingerprint == _composed_fingerprint and _workspace_loaded_key:
        logger.info("workspace_sync action=skip reason=fingerprint_match files=%d",
                     len(files))
        return

    files_written = write_composed_to_dir(files, WORKSPACE_DIR)

    sync_ms = round((time.time() - t_sync) * 1000)
    _workspace_loaded_key = f"{workspace_tenant_id}:{assistant_id}:{fingerprint}"
    _composed_fingerprint = fingerprint
    logger.info(
        "workspace_sync action=composer_fetch sync_ms=%d files=%d fingerprint=%s",
        sync_ms, files_written, fingerprint[:12],
    )


def _call_strands_agent(system_prompt: str, messages: list,
                        model: str = "",
                        skills_config: list | None = None,
                        guardrail_config: dict | None = None,
                        mcp_configs: list | None = None) -> tuple[str, dict]:
    """Invoke Strands Agent SDK.

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

    # 3. Build tool list: memory tools + Nova Act browser + file_read + script skills
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

    # Unit 7: write_memory — agent appends to its own memory/*.md working
    # notes via the composer. Basename enum (lessons.md | preferences.md |
    # contacts.md) so there's no path string to escape.
    try:
        from write_memory_tool import write_memory
        tools.append(write_memory)
        logger.info("workspace tool registered: write_memory")
    except Exception as e:
        logger.warning("write_memory registration failed: %s", e)

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
                {stdout, stderr, exit_code}. The API emits a sequence of
                chunks; we accumulate text and pull structured fields
                from the terminal event."""
                stdout_chunks: list[str] = []
                stderr_chunks: list[str] = []
                exit_code = 0
                for event in stream:
                    # Different event shapes from the stream. We don't
                    # assume a fixed schema — just pull known keys.
                    if not isinstance(event, dict):
                        continue
                    for _k, _v in event.items():
                        if isinstance(_v, dict):
                            text = _v.get("text") or _v.get("content") or ""
                            if _k.lower().startswith("stdout") and text:
                                stdout_chunks.append(text)
                            elif _k.lower().startswith("stderr") and text:
                                stderr_chunks.append(text)
                            elif "exitCode" in _v:
                                exit_code = int(_v["exitCode"])
                        elif isinstance(_v, (bytes, str)) and _k.lower().startswith("stdout"):
                            stdout_chunks.append(
                                _v.decode() if isinstance(_v, bytes) else _v,
                            )
                        elif isinstance(_v, (bytes, str)) and _k.lower().startswith("stderr"):
                            stderr_chunks.append(
                                _v.decode() if isinstance(_v, bytes) else _v,
                            )
                return {
                    "stdout": "".join(stdout_chunks),
                    "stderr": "".join(stderr_chunks),
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
        # Hindsight ECS service (semantic + BM25 + entity graph + temporal
        # retrieval with cross-encoder reranking).
        #
        # Add Hindsight memory tools (hindsight_retain/recall/reflect) via the
        # native hindsight-strands package (PRD-41B Phase 7, item 1). Replaces
        # the old custom `remember`/`recall`/`forget` wrappers that sat on top of
        # a stdlib urllib client. The native package gives us the @tool-decorated
        # functions, a proper client, and — crucially — a `tags` parameter that
        # is attached to every retain call, which we use in item 2 to attribute
        # Hindsight's Bedrock spend back to the originating agent/tenant.
        try:
            from hindsight_strands import create_hindsight_tools
            from hindsight_client import Hindsight
            # PRD-41B Phase 7 item 2: install both monkey-patches once per process.
            # - install(): wraps Hindsight.retain_batch / .reflect to capture
            #   token usage so _call_strands_agent can drain it and ship it
            #   back to chat-agent-invoke as `hindsight_usage: [...]`.
            # - install_loop_fix(): replaces hindsight_client._run_async with
            #   a fresh-event-loop variant. The stock 0.4.22 _run_async reuses
            #   loops via asyncio.get_event_loop() which interacts badly with
            #   hindsight-strands' ThreadPoolExecutor reuse, causing
            #   intermittent "Timeout context manager should be used inside a
            #   task" errors mid-request. Same root cause as upstream
            #   vectorize-io/hindsight#677/#880 (closed but only fixed in
            #   hindsight-hermes, not hindsight-client/hindsight-strands).
            try:
                import hindsight_usage_capture
                hindsight_usage_capture.install_loop_fix()
                hindsight_usage_capture.install()
                hindsight_usage_capture.reset()
            except Exception as ucap_err:
                logger.warning("hindsight_usage_capture install failed: %s", ucap_err)
            hs_endpoint = os.environ.get("HINDSIGHT_ENDPOINT", "")
            hs_bank = os.environ.get("_INSTANCE_ID", "") or os.environ.get("_ASSISTANT_ID", "")
            hs_tenant = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
            hs_assistant = os.environ.get("_ASSISTANT_ID", "")
            hs_stage = os.environ.get("STAGE", "") or "unknown"
            if hs_endpoint and hs_bank:
                hs_tags = [
                    f"agent_id:{hs_assistant}",
                    f"tenant_id:{hs_tenant}",
                    f"env:{hs_stage or 'unknown'}",
                ]
                # PRD-41B Phase 7 item 2 followup: build the Hindsight client
                # ourselves with a 5-minute timeout instead of letting
                # hindsight-strands construct one with its hardcoded 30-second
                # default (tools.py:54). Retain on long content can legitimately
                # exceed 30s — we kept seeing "Retain failed: ..." for big
                # extractions until the timeout was raised.
                hs_client = Hindsight(base_url=hs_endpoint, timeout=300.0)
                # PRD-41B Phase 7 item 3 followup (2026-04-08): the vendor docstrings on
                # `hindsight_recall` and `hindsight_reflect` from hindsight-strands==0.1.1
                # are too generic ("Search long-term memory for relevant information")
                # for smaller models to recognize them as the right tool for questions
                # like "Where does Cedric work?". Cross-model test on prod:
                #   * Sonnet 4.6 — picks hindsight_recall ✅
                #   * Haiku 4.5  — picks tools=[] and gives up ❌
                #   * Kimi K2.5  — picks search_users + 4 CRM tools (46k input tokens) ❌
                # We disable the vendor recall + reflect via enable_*=False and supply
                # our own thin @tool wrappers below with model-independent docstrings
                # that name-drop the kinds of questions they should be used for. retain
                # stays on the vendor since it's user-prompted ("remember X") and
                # rarely needs heuristic tool selection.
                from strands import tool as _strands_tool
                hs_tools = create_hindsight_tools(
                    client=hs_client,
                    bank_id=hs_bank,
                    tags=hs_tags,
                    enable_recall=False,
                    enable_reflect=False,
                )

                # Capture closure variables for the wrappers below. The wrappers
                # are `async def` so Strands awaits them on the main event loop
                # (see sdk-python/src/strands/tools/decorator.py stream()) —
                # this is critical: it means we bypass _run_async entirely and
                # aiohttp's ClientSession binds to the long-lived main loop
                # instead of a short-lived per-call loop. Sync tools would run
                # in asyncio.to_thread, which reuses worker threads with stale
                # thread-local loops — the root cause of the "Event loop is
                # closed" failures we hit on the first-ever hindsight_reflect
                # invocation. Upstream hindsight-client 0.5.1 still ships the
                # same _run_async (asyncio.get_event_loop) implementation, but
                # exposes arecall/areflect as native async variants. Use those.
                #
                # We build a FRESH Hindsight instance inside each tool call and
                # `await client.aclose()` in finally so aiohttp's ClientSession
                # + TCPConnector are released explicitly. Caching the client
                # across calls leaks "Unclosed client session" warnings on
                # every warm invocation because the session is never torn down
                # until GC, and GC-at-process-shutdown in Lambda is
                # unreliable. The fresh-client cost is ~10ms of TCP setup,
                # negligible vs. the Hindsight ECS call itself.
                _hs_endpoint_ref = hs_endpoint
                _hs_bank_ref = hs_bank

                @_strands_tool
                async def hindsight_recall(query: str) -> str:
                    """Search your long-term memory for facts about people, companies, projects, places, and prior conversations.

                    THIS IS YOUR PRIMARY TOOL for any factual question about
                    someone or something the user mentions, even if the name
                    is unfamiliar to you. Your long-term memory contains many
                    facts that are NOT in the current conversation context —
                    always check here BEFORE saying "I don't know" or asking
                    the user to clarify who someone is.

                    Use this tool when the user asks ANY of:
                      * "Where does <person> work?"
                      * "Who is <person>?"
                      * "What do I know about <person/company/project>?"
                      * "Tell me about <X>"
                      * "Have we talked about <X> before?"
                      * "What's the contact info for <X>?"
                      * Any factual recall question naming a person, company,
                        customer, product, location, or event.

                    DO NOT use `search_users` for these — that tool only finds
                    Thinkwork platform teammates (people with login accounts on
                    this app), not people you have learned about in
                    conversations.

                    DO NOT use CRM tools (`accounts`, `contacts`, `leads`,
                    `opportunities`) as the FIRST step for general "who is X"
                    or "where does X work" questions. Always try
                    hindsight_recall FIRST. Only fall back to CRM tools if
                    hindsight_recall returns "No relevant memories found."
                    AND you have a specific reason to believe the person is
                    a CRM record.

                    The query is matched via multi-strategy retrieval
                    (semantic + BM25 + entity graph + temporal) and reranked
                    by a cross-encoder. Phrase the query as the question you
                    want answered, not just keywords. Returns a numbered list
                    of matching memory facts.

                    REQUIRED FOLLOW-UP: For any "tell me about X", "what do
                    you know about Y", "summarize Z", "brief me on W", or
                    similar open-ended question about a person / company /
                    customer / project / topic, you MUST call
                    `hindsight_reflect` in the SAME turn after this tool
                    returns. Recall surfaces the raw facts; reflect runs a
                    larger LLM over those facts to produce a coherent
                    narrative answer with reasoning across multiple
                    memories. Skipping reflect for these question shapes
                    leaves the user with a flat list instead of a
                    synthesized briefing.

                    The ONLY case where you may skip the reflect follow-up
                    is a narrowly scoped factual lookup with a single
                    expected answer, e.g. "what is X's email address?",
                    "where does Y work?", "when did we last talk about Z?".
                    For anything broader, run BOTH tools.

                    Args:
                        query: The factual question or topic to search for.

                    Returns:
                        A numbered list of matching memories, or
                        "No relevant memories found." if nothing matches.
                    """
                    # Fresh client per attempt — see the closure-capture
                    # comment above for why we don't share across calls.
                    # Explicit aclose() in finally to prevent aiohttp session
                    # leaks. Retry on transient upstream errors (HTTP 5xx,
                    # BedrockException, "Try your request again"): Bedrock
                    # flaps intermittently and Hindsight surfaces those as
                    # 500s to us — we saw one in production on 2026-04-14
                    # that left the agent with "Memory reflect failed" when
                    # the next attempt would have succeeded. 2 retries with
                    # 1s/2s backoffs caps worst-case added latency at ~3s.
                    import asyncio as _asyncio
                    last_exc = None
                    for _attempt in range(3):
                        _client = Hindsight(base_url=_hs_endpoint_ref, timeout=300.0)
                        try:
                            # PRD-42 follow-up: drop budget mid→low (less graph fanout
                            # for our bank shapes) and max_tokens 4096→1500 (smaller
                            # raw pool to filter). Hindsight 0.5.0's proof_count boost
                            # (PR #821) plus our post-filter carries the weight now.
                            # Note: arecall (native async) — not recall — to avoid
                            # _run_async's stale-loop reuse.
                            response = await _client.arecall(
                                bank_id=_hs_bank_ref,
                                query=query,
                                budget="low",
                                max_tokens=1500,
                            )
                            raw = getattr(response, "results", None) or []
                            if not raw:
                                return "No relevant memories found."
                            # Post-filter: top-N pre-cap, entity-aware relevance filter,
                            # observation-preferred dedup, hard cap. See
                            # hindsight_recall_filter.py for the full pipeline and the
                            # Phase 0 Marco bank data that drove the thresholds.
                            from hindsight_recall_filter import (
                                filter_recall_results,
                                format_results_for_agent,
                            )
                            filtered = filter_recall_results(raw, query)
                            return format_results_for_agent(filtered)
                        except Exception as e:
                            last_exc = e
                            _msg = str(e)
                            _transient = (
                                "(500)" in _msg or "(502)" in _msg
                                or "(503)" in _msg or "(504)" in _msg
                                or "BedrockException" in _msg
                                or "ServiceUnavailableError" in _msg
                                or "Try your request again" in _msg
                                or "throttl" in _msg.lower()
                            )
                            if _attempt < 2 and _transient:
                                _backoff = 1.0 * (2 ** _attempt)
                                logger.warning(
                                    "hindsight_recall attempt %d/3 transient failure, retrying in %.1fs: %s",
                                    _attempt + 1, _backoff, _msg[:200],
                                )
                                await _asyncio.sleep(_backoff)
                                continue
                            logger.error(
                                "hindsight_recall failed (attempt %d/3): %s",
                                _attempt + 1, e,
                            )
                            return f"Memory recall failed: {e}"
                        finally:
                            try:
                                await _client.aclose()
                            except Exception as _close_err:
                                logger.warning("hindsight_recall aclose failed: %s", _close_err)
                    return f"Memory recall failed: {last_exc}"

                @_strands_tool
                async def hindsight_reflect(query: str) -> str:
                    """Synthesize a narrative answer over many long-term memory facts at once.

                    PAIRING WITH hindsight_recall: This tool is the second
                    half of a two-step flow. The correct order is:

                      1. `hindsight_recall(query)` → returns the raw matching facts
                      2. `hindsight_reflect(query)` → returns a synthesized
                          narrative answer over those facts

                    You should call BOTH tools in the same turn for ANY
                    open-ended memory question:

                      * "What do you know about <X>?"
                      * "Tell me about <person/company/project>"
                      * "Summarize what we know about <X>"
                      * "Brief me on <account>"
                      * "What are the key relationships between <A> and <B>?"

                    Reflect runs a larger LLM behind the scenes (more
                    expensive than recall), so the only case where you may
                    SKIP reflect is a narrowly scoped factual lookup with a
                    single expected answer ("what is X's email address?",
                    "where does Y work?"). For anything broader — anything
                    that asks for context, summary, briefing, narrative, or
                    synthesis — run reflect after recall.

                    Same scope rules as hindsight_recall: people, companies,
                    customers, projects you have stored facts about. Do NOT
                    route synthesis questions to CRM tools as a first step.

                    Args:
                        query: The synthesis question to answer from memory.

                    Returns:
                        A natural-language answer grounded in stored
                        memories, or "No relevant memories found." if there
                        is nothing to draw from.
                    """
                    # Fresh client per attempt + retry on transient upstream
                    # errors — see hindsight_recall for the rationale.
                    import asyncio as _asyncio
                    last_exc = None
                    for _attempt in range(3):
                        _client = Hindsight(base_url=_hs_endpoint_ref, timeout=300.0)
                        try:
                            # areflect (native async) — not reflect — to avoid
                            # _run_async's stale-loop reuse.
                            response = await _client.areflect(
                                bank_id=_hs_bank_ref,
                                query=query,
                                budget="mid",
                            )
                            return getattr(response, "text", None) or "No relevant memories found."
                        except Exception as e:
                            last_exc = e
                            _msg = str(e)
                            _transient = (
                                "(500)" in _msg or "(502)" in _msg
                                or "(503)" in _msg or "(504)" in _msg
                                or "BedrockException" in _msg
                                or "ServiceUnavailableError" in _msg
                                or "Try your request again" in _msg
                                or "throttl" in _msg.lower()
                            )
                            if _attempt < 2 and _transient:
                                _backoff = 1.0 * (2 ** _attempt)
                                logger.warning(
                                    "hindsight_reflect attempt %d/3 transient failure, retrying in %.1fs: %s",
                                    _attempt + 1, _backoff, _msg[:200],
                                )
                                await _asyncio.sleep(_backoff)
                                continue
                            logger.error(
                                "hindsight_reflect failed (attempt %d/3): %s",
                                _attempt + 1, e,
                            )
                            return f"Memory reflect failed: {e}"
                        finally:
                            try:
                                await _client.aclose()
                            except Exception as _close_err:
                                logger.warning("hindsight_reflect aclose failed: %s", _close_err)
                    return f"Memory reflect failed: {last_exc}"

                tools.extend(hs_tools)
                tools.append(hindsight_recall)
                tools.append(hindsight_reflect)
                logger.info("Hindsight tools registered: retain (vendor) + custom hindsight_recall/reflect bank=%s tags=%s timeout=300s",
                            hs_bank, hs_tags)

                # Compounding Memory (wiki) tools — same scope as hindsight
                # (tenant + agent). Owner id is captured in the closure so the
                # model can never address a different agent's wiki. Tools
                # return a graceful "not enabled" string if the graphql-http
                # URL/secret env vars aren't set on this deployment.
                if hs_tenant and hs_assistant:
                    try:
                        from wiki_tools import make_wiki_tools
                        search_wiki, read_wiki_page = make_wiki_tools(
                            _strands_tool,
                            tenant_id=hs_tenant,
                            owner_id=hs_assistant,
                        )
                        tools.append(search_wiki)
                        tools.append(read_wiki_page)
                        logger.info(
                            "Wiki tools registered: search_wiki + read_wiki_page "
                            "tenant=%s agent=%s", hs_tenant, hs_assistant,
                        )
                    except Exception as _wiki_err:
                        logger.warning(
                            "Wiki tools registration failed: %s", _wiki_err,
                        )
            else:
                logger.warning("Hindsight tools not registered: missing endpoint or bank_id (endpoint=%s bank=%s)",
                               "set" if hs_endpoint else "MISSING", hs_bank or "MISSING")
        except Exception as e:
            logger.warning("Hindsight tools registration failed: %s", e)

    # Add file_read tool for skill resource access
    try:
        from strands_tools import file_read as _strands_file_read
        tools.append(_strands_file_read)
        logger.info("strands_tools.file_read added for skill resource access")
    except Exception:
        logger.info("strands_tools.file_read not available")

    # Add Nova Act browser tool (AI-powered browser via AgentCore managed Chrome)
    if _nova_act_api_key:
        tools.append(_browse_website)
        logger.info("Nova Act browse_website tool added (total tools: %d)", len(tools))
    else:
        logger.warning("Nova Act API key not available — browse_website tool disabled")

    # 4. Register skill tools (PRD-38: skills as sub-agents)
    # mode: tool  → scripts registered as direct tools on parent
    # mode: agent → skill invocation spins up a sub-agent with its own reasoning loop
    from skill_runner import register_skill_tools_grouped
    tool_mode_tools, agent_mode_tools, skill_meta = register_skill_tools_grouped(skills_config or [])
    tools.extend(tool_mode_tools)
    if tool_mode_tools:
        logger.info("mode:tool skill tools registered on parent: %d", len(tool_mode_tools))

    # 5. Register mode:agent skills as sub-agent @tool functions.
    # Each mode:agent skill becomes a Strands sub-agent with its own prompt (SKILL.md),
    # tools (its scripts), and model (from skill.yaml). The orchestrator sees these as
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
        skill_md_path = os.path.join("/tmp/skills", skill_id, "SKILL.md")
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

    # PRD-31: AgentSkills plugin for progressive skill disclosure.
    # Discovery: injects <available_skills> XML into system prompt
    # Activation: built-in `skills` tool loads SKILL.md on demand
    # Execution: lists resources (scripts/, references/) for file_read
    # Skip in workspace mode — sub-agents handle their own skills.
    plugins = []
    has_workspace_map = os.path.isfile(os.path.join(WORKSPACE_DIR, "AGENTS.md"))
    if not has_workspace_map:
        try:
            from strands import AgentSkills
            skill_dirs = []
            skills_root = "/tmp/skills"
            if os.path.isdir(skills_root):
                for skill in (skills_config or []):
                    sid = skill.get("skillId", "")
                    skill_path = os.path.join(skills_root, sid)
                    if sid and os.path.isdir(skill_path) and os.path.isfile(os.path.join(skill_path, "SKILL.md")):
                        skill_dirs.append(skill_path)
            if skill_dirs:
                plugins.append(AgentSkills(skills=skill_dirs))
                logger.info("AgentSkills plugin created with %d skills", len(skill_dirs))
        except ImportError:
            logger.warning("AgentSkills not available in this strands version")

    # ── MCP client connections ────────────────────────────────────────────
    # Connect to HTTP streaming MCP servers passed in the invocation payload.
    # Each config: {name, url, transport?, auth?: {type, token}, tools?: [...]}
    # Clients are context-managed: __enter__ discovers tools, __exit__ cleans up.
    mcp_clients = []
    _mcp_tool_to_server: dict[str, str] = {}  # tool_name → server name (for tracking)
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

    if mcp_clients:
        tools.extend(mcp_clients)
        logger.info("MCP clients added to tool list: %d servers, %d tools mapped",
                     len(mcp_clients), len(_mcp_tool_to_server))

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

        # kind="run_skill" envelope — composition dispatch path. The TS
        # /api/skills/start handler fires this shape via agentcore-invoke
        # when a caller (chat dispatcher, admin catalog, scheduled job,
        # webhook) wants to run a composition. Handled synchronously within
        # this invocation; terminal state is POSTed back to /api/skills/
        # complete before we respond to the caller.
        if payload.get("kind") == "run_skill":
            from run_skill_dispatch import dispatch_run_skill
            # Set the per-invocation env aliases (TENANT_ID / AGENT_ID /
            # USER_ID / CURRENT_USER_ID / CURRENT_THREAD_ID) so sub-skills
            # invoked by the composition see the same identity they'd see
            # on the normal path. The run_skill envelope uses different
            # key names (camelCase) — translate before applying. Cleared
            # in `finally` so the warm container does not leak identity
            # into the next invocation.
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
        skills_config = payload.get("skills")
        knowledge_bases_config = payload.get("knowledge_bases")
        trigger_channel = payload.get("trigger_channel") or ""
        context_profile_name = payload.get("context_profile") or ""
        request_model = payload.get("model", "")
        agent_name = payload.get("agent_name") or ""
        human_name = payload.get("human_name") or ""
        guardrail_config = payload.get("guardrail_config")
        mcp_configs = payload.get("mcp_configs") or []
        thread_metadata = payload.get("thread_metadata") or {}
        workflow_skill = payload.get("workflow_skill")
        if mcp_configs:
            logger.info("MCP configs received: %d servers (%s)",
                        len(mcp_configs),
                        ", ".join(c.get("name", c.get("url", "?")) for c in mcp_configs))

        # Set workspace bucket from payload (injected by SST)
        workspace_bucket = payload.get("workspace_bucket") or ""
        if workspace_bucket:
            os.environ["AGENTCORE_FILES_BUCKET"] = workspace_bucket
            logger.info("AGENTCORE_FILES_BUCKET set from payload: %s", workspace_bucket)

        # Unit 7: composer endpoint URL + service secret for workspace fetch
        # + write_memory tool. chat-agent-invoke.ts plumbs these through.
        thinkwork_api_url = payload.get("thinkwork_api_url") or ""
        if thinkwork_api_url:
            os.environ["THINKWORK_API_URL"] = thinkwork_api_url
        thinkwork_api_secret = payload.get("thinkwork_api_secret") or ""
        if thinkwork_api_secret:
            os.environ["THINKWORK_API_SECRET"] = thinkwork_api_secret
            # API_AUTH_SECRET is the canonical name on the backend; match it
            # here so both names resolve.
            os.environ["API_AUTH_SECRET"] = thinkwork_api_secret

        hindsight_endpoint = payload.get("hindsight_endpoint") or ""
        if hindsight_endpoint:
            os.environ["HINDSIGHT_ENDPOINT"] = hindsight_endpoint
            logger.info("HINDSIGHT_ENDPOINT set from payload: %s", hindsight_endpoint)

        if instance_id:
            os.environ["_INSTANCE_ID"] = instance_id

        # Per-invocation identity env (TENANT_ID / AGENT_ID / USER_ID /
        # CURRENT_USER_ID / CURRENT_THREAD_ID + underscored MCP aliases),
        # plus the sandbox fields when the dispatcher's pre-flight
        # returned status=ready. Without threading sandbox_interpreter_id
        # through here, apply_invocation_env never sets
        # SANDBOX_INTERPRETER_ID in os.environ and the execute_code
        # registration branch below (see ~line 545) silently skips.
        # CURRENT_USER_ID is only set when user_id is truthy — a missing
        # invoker must be distinguishable from an empty-string one so the
        # admin skill's R15 "no invoker" refusal triggers correctly. The
        # returned key list is cleared in the `finally` below so warm
        # containers don't leak one invocation's identity into the next.
        invocation_env_keys = invocation_env.apply_invocation_env({
            "workspace_tenant_id": workspace_tenant_id,
            "assistant_id": assistant_id,
            "user_id": user_id,
            "thread_id": ticket_id,
            "sandbox_interpreter_id": payload.get("sandbox_interpreter_id") or "",
            "sandbox_environment": payload.get("sandbox_environment") or "",
        })

        # Selective skill sync for configured skills
        if skills_config:
            from install_skills import install_skill_from_s3
            for skill in skills_config:
                skill_id = skill.get("skillId", "")
                s3_key = skill.get("s3Key", "")
                if skill_id and s3_key:
                    install_skill_from_s3(s3_key, skill_id)

        # Sync workspace from S3
        _ensure_workspace_ready(workspace_tenant_id, assistant_id, skills_config,
                                tenant_slug=tenant_slug, instance_id=instance_id,
                                agent_name=agent_name, human_name=human_name)

        # Inject skill credentials from Secrets Manager
        injected_env_keys = _inject_skill_env(skills_config) if skills_config else []

        # Tag every span emitted during this invocation with stable IDs so
        # the eval-runner can query CloudWatch aws/spans by session.id and
        # hand the resulting batch to AgentCore Evaluations.
        from eval_span_attrs import attach_eval_context, detach_eval_context
        _eval_ctx_token = attach_eval_context(
            session_id=tenant_id,
            tenant_id=workspace_tenant_id,
            agent_id=assistant_id,
            thread_id=ticket_id,
        )

        try:
            if assistant_id:
                os.environ["_ASSISTANT_ID"] = assistant_id

            # Build messages from history pre-loaded by the API layer from
            # Aurora `messages` table. chat-agent-invoke selects the last 30
            # turns and ships them inline in `messages_history`, and we hand
            # the list to Strands directly. Automatic retention into AgentCore
            # Memory happens AFTER the Strands call returns (see the
            # store_turn_pair hook after _audit_response below) so background
            # strategies can extract facts for future recall.
            messages = []
            history_payload = payload.get("messages_history") or []
            if isinstance(history_payload, list):
                for hmsg in history_payload:
                    if not isinstance(hmsg, dict):
                        continue
                    role = hmsg.get("role")
                    content = hmsg.get("content")
                    if role in ("user", "assistant") and isinstance(content, str) and content:
                        messages.append({"role": role, "content": content})

            # Always append the current user message last
            messages.append({"role": "user", "content": message})
            logger.info("Built messages list: %d prior + 1 current (use_memory=%s)",
                        len(messages) - 1, use_memory)

            # Resolve context: prefer harness-provided workspace_files, fall back to ROUTER.md
            harness_files = payload.get("workspace_files")
            profile = None
            effective_skills = skills_config

            if harness_files and isinstance(harness_files, list):
                # Harness resolved profile — use provided file list directly
                from router_parser import ContextProfile
                profile = ContextProfile(load=harness_files, skills=["all"])
                logger.info("Using harness-provided workspace_files: %d files", len(harness_files))
            else:
                # Fallback: parse ROUTER.md locally (BYOB-compatible path)
                from router_parser import resolve_profile, filter_skills
                router_path = os.path.join(WORKSPACE_DIR, "ROUTER.md")
                profile = resolve_profile(router_path, channel=trigger_channel,
                                          context_profile=context_profile_name or None)
                if profile and skills_config:
                    effective_skills = filter_skills(skills_config, profile.skills)

            # Build system prompt from workspace files (profile-aware)
            # When AGENTS.md exists (workspace mode), skip KB injection on parent —
            # KBs are assigned per-workspace, not auto-injected on every turn.
            has_workspace_map = os.path.isfile(os.path.join(WORKSPACE_DIR, "AGENTS.md"))
            parent_kb_config = None if has_workspace_map else knowledge_bases_config
            system_prompt = _build_system_prompt(effective_skills, parent_kb_config,
                                                 profile=profile)

            # External-task context injection: when the thread carries an
            # external-task envelope (LastMile etc.), append a structured
            # summary so the agent knows what task the user is looking at.
            # Without this the agent only sees the literal user message and
            # has no idea the conversation is about a specific task.
            external_block = format_external_task_context(thread_metadata)
            if external_block:
                system_prompt += "\n\n---\n\n" + external_block
                logger.info("Injected external-task context into system prompt (%d chars)",
                            len(external_block))

            # Workflow-skill injection: on task-creation threads the
            # per-workflow `skill` block from LastMile carries the
            # workflow's intake instructions, form schema, and — critically —
            # the workflowId the agent must pass verbatim to
            # `workflow_task_create`. Without this block the agent has no
            # way to substitute the real workflow id and ends up passing
            # the literal template string, which LastMile rejects with
            # "Workflow not found".
            workflow_block = format_workflow_skill_context(workflow_skill)
            if workflow_block:
                system_prompt += "\n\n---\n\n" + workflow_block
                logger.info("Injected workflow-skill context into system prompt (%d chars)",
                            len(workflow_block))

            # Auto-retrieve relevant KB context — only for agents WITHOUT workspace map
            if knowledge_bases_config and not has_workspace_map:
                try:
                    kb_context = _retrieve_kb_context(knowledge_bases_config, message)
                    if kb_context:
                        system_prompt += "\n\n---\n\n" + kb_context
                except Exception as e:
                    logger.warning("KB retrieval failed: %s", e)
            elif has_workspace_map and knowledge_bases_config:
                logger.info("Skipping parent KB injection — KBs managed per-workspace (%d KBs)",
                            len(knowledge_bases_config))

            start_ms = int(time.time() * 1000)
            try:
                # Call Strands Agent SDK
                response_text, strands_usage = _call_strands_agent(
                    system_prompt, messages, model=request_model,
                    skills_config=skills_config,
                    guardrail_config=guardrail_config,
                    mcp_configs=mcp_configs if mcp_configs else None,
                )

                duration_ms = int(time.time() * 1000) - start_ms

                input_tokens = strands_usage.get("input_tokens", 0)
                output_tokens = strands_usage.get("output_tokens", 0)

                # Collect tool costs from this invocation
                invocation_tool_costs = list(_tool_costs)
                _tool_costs.clear()

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
            detach_eval_context(_eval_ctx_token)
            _cleanup_skill_env(injected_env_keys)
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

    # Load Nova Act API key from SSM
    global _nova_act_api_key
    _nova_act_api_key = _load_nova_act_key()

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
