ARG COGNEE_BASE_IMAGE=cognee/cognee@sha256:5ce7e4052b1d16738d1e24476d64847fcb5b1666631b642651e8ccce414046f8
FROM ${COGNEE_BASE_IMAGE}

# LiteLLM's Bedrock Converse adapter imports boto3 at extraction time. Cognee's
# PATH points at the uv-built runtime venv, which intentionally omits pip, so
# install the dependency into the venv import path with the system Python that
# remains in the final image.
RUN /usr/local/bin/python -m pip install \
      --no-cache-dir \
      --target /app/.venv/lib/python3.12/site-packages \
      "boto3>=1.34.0"
