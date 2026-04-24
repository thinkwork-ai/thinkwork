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

# Copy every runtime module in one wildcard. The predecessor of this line was
# a hand-maintained list of ~20 explicit COPYs, one per .py file; it silently
# dropped four new modules in seven days (see docs/solutions/build-errors/
# dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md). Any new
# runtime module goes under container-sources/ and ships automatically.
COPY packages/agentcore-strands/agent-container/container-sources/ /app/

# Shared Agent Container modules from packages/agentcore/agent-container/. These
# live in a different package with a different review workflow, so we keep
# their COPY lines explicit here — the wildcard is scoped to agentcore-strands.
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

# Auth-agent module (lives under /app/auth-agent/, not flat)
RUN mkdir -p /app/auth-agent
COPY packages/agentcore/auth-agent/permission_request.py /app/auth-agent/permission_request.py
COPY packages/agentcore/auth-agent/__init__.py /app/auth-agent/__init__.py

# Build-time filesystem check: fail the image build loud if any module
# enumerated in _boot_assert.EXPECTED_* is missing from /app. Same assertion
# runs again at server startup in case a packaging step drops a file between
# build and launch. Replaces the older ad-hoc `python -c "import sandbox_tool; …"`
# lines which only covered two modules.
RUN python /app/_boot_assert.py /app

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

# Build provenance — wired by deploy.yml so a single log line on boot
# answers "which image is this container actually running?". When the
# runtime sticks on a stale image (see AgentCore runtime no-auto-repull),
# grepping THINKWORK_BUILD= in the boot log tells you the bound commit
# without having to cross-reference ECR tags.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV THINKWORK_GIT_SHA=${GIT_SHA}
ENV THINKWORK_BUILD_TIME=${BUILD_TIME}
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
