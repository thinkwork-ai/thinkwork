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

# Install Python dependencies (includes strands-agents)
COPY packages/agentcore-strands/agent-container/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install chromium --with-deps 2>/dev/null || true && \
    find /usr/local/lib/python3.12 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Copy runtime server + skill runner (memory tools come from hindsight-strands
# package installed via requirements.txt, PRD-41B Phase 7 item 1).
# hindsight_usage_capture.py monkey-patches the HindsightClient to capture
# token usage for cost attribution (PRD-41B Phase 7 item 2).
COPY packages/agentcore-strands/agent-container/server.py .
COPY packages/agentcore-strands/agent-container/skill_runner.py .
COPY packages/agentcore-strands/agent-container/hindsight_usage_capture.py .
# PRD-42 follow-up: post-recall filter (entity-aware + observation-preferred dedup
# + lexical near-dup collapse + hard cap). Imported by server.py hindsight_recall
# tool. Pure stdlib so no requirements.txt change needed.
COPY packages/agentcore-strands/agent-container/hindsight_recall_filter.py .

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
ENV AGENTCORE_MEMORY_ID=thinkwork_memory-0NB7y1DcXl

EXPOSE 8080

CMD ["python", "server.py"]
