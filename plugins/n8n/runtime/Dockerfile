ARG N8N_BASE_IMAGE=n8nio/n8n:2.27.3@sha256:a772d24e6b4f9b3848be5a57c5e45437eed1965bbbcefa2f9a93f4835b6639fa
FROM ${N8N_BASE_IMAGE}

USER root

COPY package.json package-lock.json /tmp/thinkwork-n8n-packages/
RUN cd /tmp/thinkwork-n8n-packages \
    && npm ci --omit=dev --ignore-scripts \
    && mkdir -p /usr/local/lib/node_modules/n8n/node_modules \
    && if [ -d node_modules ]; then cp -R node_modules/. /usr/local/lib/node_modules/n8n/node_modules/; fi \
    && npm cache clean --force \
    && rm -rf /tmp/thinkwork-n8n-packages

ENV NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules

COPY n8n-task-runners.json /etc/n8n-task-runners.json

USER node
