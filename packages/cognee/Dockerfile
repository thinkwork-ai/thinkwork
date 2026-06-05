ARG COGNEE_BASE_IMAGE=cognee/cognee@sha256:5ce7e4052b1d16738d1e24476d64847fcb5b1666631b642651e8ccce414046f8
FROM ${COGNEE_BASE_IMAGE}

# LiteLLM's Bedrock Converse adapter imports boto3 at extraction time. The
# reviewed upstream Cognee digest used by dev does not include it in /app/.venv.
RUN if [ -x /app/.venv/bin/python ]; then \
      /app/.venv/bin/python -m pip install --no-cache-dir "boto3>=1.34.0"; \
    else \
      python -m pip install --no-cache-dir "boto3>=1.34.0"; \
    fi
