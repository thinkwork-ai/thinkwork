# AgentCore Strands — Multi-model runtime powered by Strands Agent SDK
# Pure Python — no Node.js dependency. Supports any Bedrock model.
# Build from monorepo root: docker build -f packages/agentcore-strands/agent-container/Dockerfile .

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (includes strands-agents + hindsight-strands)
COPY packages/agentcore-strands/agent-container/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps 2>/dev/null || true && \
    find /usr/local/lib/python3.12 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Copy runtime server + skill runner + composition pipeline
COPY packages/agentcore-strands/agent-container/server.py .
COPY packages/agentcore-strands/agent-container/skill_runner.py .
COPY packages/agentcore-strands/agent-container/skill_inputs.py .
COPY packages/agentcore-strands/agent-container/composition_runner.py .
COPY packages/agentcore-strands/agent-container/eval_span_attrs.py .

# Memory engine: managed (AgentCore) or hindsight (external service)
# - memory_tools.py: remember/recall/forget for managed engine
# - hindsight_usage_capture.py: cost attribution for hindsight engine
# - hindsight_recall_filter.py: post-recall entity-aware filter for hindsight
# - api_memory_client.py: bridge to API memory-retain Lambda for the
#   per-turn auto-retention path (engine-agnostic)
COPY packages/agentcore-strands/agent-container/external_task_context.py .
COPY packages/agentcore-strands/agent-container/workflow_skill_context.py .
COPY packages/agentcore-strands/agent-container/memory_tools.py .
COPY packages/agentcore-strands/agent-container/write_memory_tool.py .
# Self-serve agent tools (docs/plans/2026-04-22-003-...-plan.md). Without
# these three COPY lines the server.py registration block silently
# falls through to warning-level logs — the tools never reach the
# agent's toolset and the model loudly refuses the actions it's been
# told (via MEMORY_GUIDE.md) it can take.
COPY packages/agentcore-strands/agent-container/update_agent_name_tool.py .
COPY packages/agentcore-strands/agent-container/update_identity_tool.py .
COPY packages/agentcore-strands/agent-container/update_user_profile_tool.py .
COPY packages/agentcore-strands/agent-container/invocation_env.py .
COPY packages/agentcore-strands/agent-container/workspace_composer_client.py .
COPY packages/agentcore-strands/agent-container/hindsight_usage_capture.py .
COPY packages/agentcore-strands/agent-container/hindsight_recall_filter.py .
COPY packages/agentcore-strands/agent-container/api_memory_client.py .
COPY packages/agentcore-strands/agent-container/run_skill_dispatch.py .
# Top-of-module import in server.py (landed via #401). Missing this line
# crashed the container on startup with ModuleNotFoundError — every chat
# turn failed until the COPY list caught up. 4th occurrence of this class
# of bug, see docs/solutions/build-errors/dockerfile-explicit-copy-list-
# drops-new-tool-modules-2026-04-22.md.
COPY packages/agentcore-strands/agent-container/invocation_env.py .
# Lazy-imported by server.py inside the wiki-tools registration path
# (landed in #199). Not the trigger for the active outage but fails at
# runtime the first time the wiki tool is invoked — same class, zero cost
# to fix while we're here.
COPY packages/agentcore-strands/agent-container/wiki_tools.py .
# AgentCore Code Sandbox execute_code tool (plan Unit 7). Lazy-imported
# by server.py only when SANDBOX_INTERPRETER_ID is set; without this
# COPY the import fails loud on first sandbox turn. Same class of bug
# as the other entries in this block — see
# docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md.
COPY packages/agentcore-strands/agent-container/sandbox_tool.py .
# AgentCore Code Sandbox preamble builder (plan Unit 8). Same
# lazy-import class of bug as sandbox_tool — explicit COPY + build-time
# import assertion.
COPY packages/agentcore-strands/agent-container/sandbox_preamble.py .

# Build-time assertion: fail the image build loud if either sandbox
# module is missing or can't import cleanly. Without these, a regression
# on the COPY lines above only surfaces on the first sandbox-enabled
# turn in production — hours after deploy.
RUN python -c "import sandbox_tool; assert hasattr(sandbox_tool, 'build_execute_code_tool'), 'sandbox_tool missing factory'; print('sandbox_tool: OK')"
RUN python -c "import sandbox_preamble; assert hasattr(sandbox_preamble, 'build_preamble'), 'sandbox_preamble missing build_preamble'; print('sandbox_preamble: OK')"

# Copy shared Agent Container modules
COPY packages/agentcore/agent-container/permissions.py .
COPY packages/agentcore/agent-container/identity.py .
COPY packages/agentcore/agent-container/memory.py .
COPY packages/agentcore/agent-container/observability.py .
COPY packages/agentcore/agent-container/safety.py .
COPY packages/agentcore/agent-container/bedrock_request_tracker.py .
COPY packages/agentcore/agent-container/install_skills.py .
COPY packages/agentcore/agent-container/router_parser.py .
COPY packages/agentcore/agent-container/context_parser.py .
COPY packages/agentcore/agent-container/kb_search_server.py .
COPY packages/agentcore/agent-container/hindsight_client.py ./hs_urllib_client.py

# Copy auth-agent module
RUN mkdir -p /app/auth-agent
COPY packages/agentcore/auth-agent/permission_request.py /app/auth-agent/permission_request.py
COPY packages/agentcore/auth-agent/__init__.py /app/auth-agent/__init__.py

# Create required directories
RUN mkdir -p /app/skills /app/workspace

# Create non-root user
RUN useradd -m -s /bin/bash strandsuser && \
    chown -R strandsuser:strandsuser /app /tmp /home/strandsuser

USER strandsuser

ENV PORT=8080
ENV HOME=/home/strandsuser
ENV AWS_REGION=us-east-1
ENV AGENTCORE_FILES_BUCKET=""
# AgentCore Memory ID — always populated by Terraform. Managed memory is
# always on; Hindsight is an optional add-on enabled when HINDSIGHT_ENDPOINT
# is also set in the environment.
ENV AGENTCORE_MEMORY_ID=""

# OpenTelemetry / ADOT — emit spans for AgentCore Evaluations to score.
# AgentCore Runtime injects OTEL_EXPORTER_OTLP_ENDPOINT at start; the
# distro + configurator below wire boto3/Strands/HTTP auto-instrumentation.
ENV OTEL_PYTHON_DISTRO=aws_distro
ENV OTEL_PYTHON_CONFIGURATOR=aws_configurator

EXPOSE 8080

# Lambda Web Adapter — bridges Lambda invoke events ↔ HTTP server.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/ping

CMD ["opentelemetry-instrument", "python", "server.py"]
