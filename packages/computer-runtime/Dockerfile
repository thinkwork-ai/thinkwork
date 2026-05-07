FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV RUNTIME_VERSION=phase2-skeleton
ENV GOOGLE_WORKSPACE_CLI_BIN=gws

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @googleworkspace/cli@0.22.5 \
  && mkdir -p /workspace \
  && chown node:node /workspace

COPY package.json ./package.json
COPY dist/src ./dist/src

USER node

CMD ["node", "dist/src/index.js"]
