FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV RUNTIME_VERSION=phase2-skeleton

RUN mkdir -p /workspace && chown node:node /workspace

COPY package.json ./package.json
COPY dist/src ./dist/src

USER node

CMD ["node", "dist/src/index.js"]
