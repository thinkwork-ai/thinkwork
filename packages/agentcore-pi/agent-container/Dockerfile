# AgentCore Pi runtime — Node.js runtime powered by badlogic/pi-mono.
# Build from monorepo root:
#   docker build -f packages/agentcore-pi/agent-container/Dockerfile .

# Node 22: the @earendil-works/pi-* SDK requires node >=22.19 (pi-coding-agent
# engines), and the monorepo floor is Node 22. On Node 20 the runtime cold-starts
# fine but the first turn's createAgentSession import hits a Node 22+ API and the
# process exits 1 ("Runtime exited with error: exit status 1").
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

# Python 3.11 + pip for the skill-bridge subprocess (plan §005 U5).
# Bookworm ships python 3.11 as `python3`; no separate version pin needed.
# `boto3` covers every third-party import used by the current workspace
# script-skill corpus. New skills that add deps should extend
# `packages/agentcore-pi/agent-container/requirements.txt` rather than
# inlining `pip install` here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agentcore-pi/package.json packages/agentcore-pi/package.json
COPY packages/agentcore-pi/tsconfig.json packages/agentcore-pi/tsconfig.json
COPY packages/agentcore-pi/agent-container/src/ packages/agentcore-pi/agent-container/src/
COPY packages/agentcore-pi/agent-container/skill-bridge/ packages/agentcore-pi/agent-container/skill-bridge/
COPY packages/agentcore-pi/agent-container/requirements.txt packages/agentcore-pi/agent-container/requirements.txt

# Install the Python deps the skill-bridge needs at runtime. `--break-system-packages`
# is required on Debian Bookworm (PEP 668) — the container is a single-purpose
# image, so the system-wide install is intentional.
RUN pip3 install --no-cache-dir --break-system-packages \
    -r packages/agentcore-pi/agent-container/requirements.txt

# @thinkwork/pi-aws + @thinkwork/pi-runtime-core workspace deps.
# pnpm install --frozen-lockfile fails when a workspace dep's directory is
# absent, and the build needs the source to compile against. Both the
# package.json AND the source go in for each.
COPY packages/pi-aws/package.json packages/pi-aws/package.json
COPY packages/pi-aws/tsconfig.json packages/pi-aws/tsconfig.json
COPY packages/pi-aws/src/ packages/pi-aws/src/
COPY packages/pi-aws/connectors/ packages/pi-aws/connectors/
COPY packages/pi-runtime-core/package.json packages/pi-runtime-core/package.json
COPY packages/pi-runtime-core/tsconfig.json packages/pi-runtime-core/tsconfig.json
COPY packages/pi-runtime-core/src/ packages/pi-runtime-core/src/
# @thinkwork/pi-extensions — shared Pi-extension capability package (plan §004
# U5). agentcore-pi loads the memory extension from it; the source must be
# present for the frozen install + the tsc compile against it.
COPY packages/pi-extensions/package.json packages/pi-extensions/package.json
COPY packages/pi-extensions/tsconfig.json packages/pi-extensions/tsconfig.json
COPY packages/pi-extensions/src/ packages/pi-extensions/src/

# All four packages must be in the install filter so their devDependencies
# (in particular, typescript / tsc) land in node_modules. Filtering on
# `@thinkwork/agentcore-pi` alone pulls in its workspace deps'
# RUNTIME deps via the workspace edge but skips their devDeps — the next
# `tsc --build` step then fails with `sh: 1: tsc: not found`.
RUN corepack enable && pnpm install \
    --filter @thinkwork/agentcore-pi \
    --filter @thinkwork/pi-aws \
    --filter @thinkwork/pi-runtime-core \
    --filter @thinkwork/pi-extensions \
    --prod=false --frozen-lockfile
# Build the workspace deps first so their dist/ exists for the runtime import
# path (package.json's `import` condition points at dist/src/index.js — vitest
# tolerates raw .ts via the `types` condition, but plain Node ESM does not).
# pi-extensions depends on pi-runtime-core, so build it after.
RUN pnpm --filter @thinkwork/pi-aws build
RUN pnpm --filter @thinkwork/pi-runtime-core build
RUN pnpm --filter @thinkwork/pi-extensions build
RUN pnpm --filter @thinkwork/agentcore-pi build

ENV PORT=8080
ENV AWS_REGION=us-east-1
ENV NODE_ENV=production
ENV WORKSPACE_DIR=/workspace
# AgentCore runs the image filesystem read-only; only /tmp is writable.
# Keep the public runtime contract at /workspace while storing bytes under
# /tmp/workspace where S3 hydration and just-bash writes can succeed.
RUN mkdir -p /tmp/workspace && ln -s /tmp/workspace /workspace

ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV THINKWORK_GIT_SHA=${GIT_SHA}
ENV THINKWORK_BUILD_TIME=${BUILD_TIME}

EXPOSE 8080

# Lambda Web Adapter — bridges Lambda invoke events to the HTTP server.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/ping

CMD ["node", "/app/packages/agentcore-pi/dist/agent-container/src/server.js"]
