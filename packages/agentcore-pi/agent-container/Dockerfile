# AgentCore Pi runtime — Node.js runtime powered by badlogic/pi-mono.
# Build from monorepo root:
#   docker build -f packages/agentcore-pi/agent-container/Dockerfile .

FROM node:20-bookworm-slim

# Python 3.11 + pip for the skill-bridge subprocess (plan §005 U5).
# Bookworm ships python 3.11 as `python3`; no separate version pin needed.
# `boto3` covers every third-party import in `packages/skill-catalog/*/scripts/`
# at the time of writing — verified by grep against `^import\|^from` across
# all skill scripts. New skills that add deps should extend
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

# @thinkwork/pi-aws workspace dep (plan §005 U8 — sandbox factory).
# pnpm install --frozen-lockfile fails when a workspace dep's directory is
# absent, and the build needs the source to compile against. Both the
# package.json AND the source go in.
COPY packages/pi-aws/package.json packages/pi-aws/package.json
COPY packages/pi-aws/tsconfig.json packages/pi-aws/tsconfig.json
COPY packages/pi-aws/src/ packages/pi-aws/src/
COPY packages/pi-aws/connectors/ packages/pi-aws/connectors/

# Both packages must be in the install filter so their devDependencies
# (in particular, typescript / tsc) land in node_modules. Filtering on
# `@thinkwork/agentcore-pi` alone pulls in `@thinkwork/pi-aws`'s
# RUNTIME deps via the workspace edge but skips its devDeps — the next
# `tsc --build` step then fails with `sh: 1: tsc: not found`.
RUN corepack enable && pnpm install \
    --filter @thinkwork/agentcore-pi \
    --filter @thinkwork/pi-aws \
    --prod=false --frozen-lockfile
# Build pi-aws first so its dist/ exists for the runtime import path
# (package.json's `import` condition points at dist/src/index.js — vitest
# tolerates raw .ts via the `types` condition, but plain Node ESM does not).
RUN pnpm --filter @thinkwork/pi-aws build
RUN pnpm --filter @thinkwork/agentcore-pi build

ENV PORT=8080
ENV AWS_REGION=us-east-1
ENV NODE_ENV=production

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
