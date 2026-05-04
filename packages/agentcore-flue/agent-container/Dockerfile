# AgentCore Flue runtime — Node.js runtime powered by badlogic/pi-mono.
# Build from monorepo root:
#   docker build -f packages/agentcore-flue/agent-container/Dockerfile .

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agentcore-flue/package.json packages/agentcore-flue/package.json
COPY packages/agentcore-flue/tsconfig.json packages/agentcore-flue/tsconfig.json
COPY packages/agentcore-flue/agent-container/src/ packages/agentcore-flue/agent-container/src/

# @thinkwork/flue-aws workspace dep (plan §005 U8 — sandbox factory).
# pnpm install --frozen-lockfile fails when a workspace dep's directory is
# absent, and the build needs the source to compile against. Both the
# package.json AND the source go in.
COPY packages/flue-aws/package.json packages/flue-aws/package.json
COPY packages/flue-aws/tsconfig.json packages/flue-aws/tsconfig.json
COPY packages/flue-aws/src/ packages/flue-aws/src/
COPY packages/flue-aws/connectors/ packages/flue-aws/connectors/

RUN corepack enable && pnpm install --filter @thinkwork/agentcore-flue --prod=false --frozen-lockfile
# Build flue-aws first so its dist/ exists for the runtime import path
# (package.json's `import` condition points at dist/src/index.js — vitest
# tolerates raw .ts via the `types` condition, but plain Node ESM does not).
RUN pnpm --filter @thinkwork/flue-aws build
RUN pnpm --filter @thinkwork/agentcore-flue build

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

CMD ["node", "/app/packages/agentcore-flue/dist/agent-container/src/server.js"]
