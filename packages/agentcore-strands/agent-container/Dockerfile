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

# Copy runtime server + skill runner
COPY packages/agentcore-strands/agent-container/server.py .
COPY packages/agentcore-strands/agent-container/skill_runner.py .
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
COPY packages/agentcore-strands/agent-container/workspace_composer_client.py .
COPY packages/agentcore-strands/agent-container/hindsight_usage_capture.py .
COPY packages/agentcore-strands/agent-container/hindsight_recall_filter.py .
COPY packages/agentcore-strands/agent-container/api_memory_client.py .

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
