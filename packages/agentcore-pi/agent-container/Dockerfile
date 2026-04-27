# AgentCore Pi runtime — Node.js runtime powered by badlogic/pi-mono.
# Build from monorepo root:
#   docker build -f packages/agentcore-pi/agent-container/Dockerfile .

FROM node:20-bookworm-slim

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

RUN corepack enable && pnpm install --filter @thinkwork/agentcore-pi --prod=false --frozen-lockfile
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
