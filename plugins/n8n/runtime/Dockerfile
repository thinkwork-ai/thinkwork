ARG N8N_BASE_IMAGE=n8nio/n8n:1.98.2@sha256:3cd4d08ff918d53516b32c2e2a6188bdf60efd25a68ca036dbda30de6ef3a281
FROM ${N8N_BASE_IMAGE}

USER root

COPY package.json package-lock.json /tmp/thinkwork-n8n-packages/
RUN cd /tmp/thinkwork-n8n-packages \
    && npm ci --omit=dev --ignore-scripts \
    && mkdir -p /usr/local/lib/node_modules/n8n/node_modules \
    && cp -R node_modules/. /usr/local/lib/node_modules/n8n/node_modules/ \
    && npm cache clean --force \
    && rm -rf /tmp/thinkwork-n8n-packages

ENV NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules

COPY n8n-task-runners.json /etc/n8n-task-runners.json

USER node
