"""sandbox_preamble — build the Python source the dispatcher sends as the
first executeCode call in each sandbox session (plan Unit 8).

## Why the preamble is a separate executeCode call

The preamble reads fresh OAuth access tokens from Secrets Manager and
exports them to ``os.environ`` so user code has (e.g.)
``GITHUB_ACCESS_TOKEN`` available via ``os.environ`` — but it must not
be a string concatenated with user code. Triple-quote tricks,
indentation tampering, or a stray string terminator in user code could
let the user escape the preamble boundary. Running the preamble as its
own executeCode call (#1) and user code as call #2+ eliminates that
surface entirely — the Python parser never sees them in one source.

## The preamble only ships path strings, never token values

The preamble builder takes only Secrets Manager ARN paths + connection
types + the session-token-registration entry point. No token *value*
ever appears in the executeCode request payload, so CloudWatch's
APPLICATION_LOGS view can never surface one even under a logging
regression.

## sitecustomize registration

The base image already ships ``sitecustomize.py`` (Unit 4) with the
stdio redactor active. The preamble registers each token value into
the redactor's session-scoped set **before** exporting to
``os.environ`` — by the time user code runs, any accidental
``print(os.environ['GITHUB_ACCESS_TOKEN'])`` redacts through stdio.

Version marker: the preamble emits a leading comment with the
``thinkwork_preamble_version`` the base image expects. Mismatch means
the image and the preamble shipped out-of-sync; the sitecustomize
check raises a loud error rather than silently running an untrusted
shape.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

# Current preamble shape. Bump when the contract with sitecustomize
# changes (new redactor API, new os.environ keys, etc.).
PREAMBLE_VERSION = 1

# Env-var name mapping per connection_type. Must match the mapping in
# packages/api/src/lib/oauth-token.ts:buildSkillEnvOverrides so user
# code sees the same variable name the typed skills do.
ENV_VAR_BY_CONNECTION_TYPE: dict[str, str] = {
    "github": "GITHUB_ACCESS_TOKEN",
    "slack": "SLACK_ACCESS_TOKEN",
    "google": "GOOGLE_ACCESS_TOKEN",
}


@dataclass
class PreambleInputs:
    """Inputs the dispatcher passes to build_preamble.

    secret_paths: dict of connection_type → Secrets Manager ARN path. The
      dispatcher has already written the fresh access token at each path
      using sandbox-secrets.writeSandboxSecrets.
    """

    tenant_id: str
    user_id: str
    stage: str
    secret_paths: dict[str, str]


def build_preamble(inputs: PreambleInputs) -> str:
    """Return the Python source the dispatcher sends as executeCode call #1.

    The generated source:
      1. Imports boto3 + sitecustomize (sitecustomize should already be
         installed; importing it is a no-op if active, loud failure if
         not).
      2. Reads each secret at the declared path via the sandbox's
         per-tenant IAM role.
      3. Registers every value into the sitecustomize redactor's
         session-scoped set.
      4. Exports each to os.environ under the connection-type-specific
         name.
      5. Prints a readiness marker so the dispatcher knows call #1
         succeeded before sending call #2.

    Never interpolates token values into source — only paths. The
    dispatcher writes tokens to SM separately (see writeSandboxSecrets).
    """
    # Inputs we interpolate: tenant/user/stage identifiers (opaque UUIDs),
    # connection-type slugs (allowlist), and SM ARN paths. All three are
    # safe to JSON-encode into the generated source; none carry token
    # material.
    declarations = [
        {
            "env_var": ENV_VAR_BY_CONNECTION_TYPE[ctype],
            "path": path,
            "connection_type": ctype,
        }
        for ctype, path in inputs.secret_paths.items()
        if ctype in ENV_VAR_BY_CONNECTION_TYPE
    ]

    # json.dumps emits a Python-safe literal for every declaration. The
    # preamble is then safe to eval regardless of what's in the user
    # portion of the payload — because user code runs as call #2.
    declarations_literal = json.dumps(declarations)

    return f"""# thinkwork_preamble_version: {PREAMBLE_VERSION}
# tenant: {inputs.tenant_id}
# user:   {inputs.user_id}
# stage:  {inputs.stage}
#
# This is executeCode call #1 — it must run to completion before any
# user code. The redactor wrapping sys.stdout is already installed by
# the base image's sitecustomize.py; we only register token values
# into its session-scoped set here.

import json as _tw_json
import os as _tw_os
import sys as _tw_sys

import boto3 as _tw_boto3

try:
    import sitecustomize as _tw_sc
except ImportError as _tw_err:
    # The base image's sitecustomize.py is a hard dependency of the
    # sandbox. If it's missing, refuse to run — failing loud here is
    # better than leaking tokens on an unmitigated image.
    raise RuntimeError(
        "sitecustomize not importable inside the sandbox; refusing to run"
    ) from _tw_err

if not _tw_sc.installed():
    raise RuntimeError(
        "sitecustomize did not install its stdio wrapper; refusing to run"
    )

_tw_declarations = _tw_json.loads({declarations_literal!r})
_tw_sm = _tw_boto3.client("secretsmanager")

for _tw_decl in _tw_declarations:
    _tw_resp = _tw_sm.get_secret_value(SecretId=_tw_decl["path"])
    _tw_value = _tw_resp["SecretString"]
    # Register the *cleartext* value with sitecustomize; the redactor
    # expands it into base64 / URL-safe / URL-encoded / hex forms
    # internally.
    _tw_sc.register_token(_tw_value)
    _tw_os.environ[_tw_decl["env_var"]] = _tw_value

# Readiness marker — the dispatcher greps for this before proceeding.
# The string itself is not redacted because it contains no token
# material.
print("__thinkwork_sandbox_ready__", flush=True)
"""
