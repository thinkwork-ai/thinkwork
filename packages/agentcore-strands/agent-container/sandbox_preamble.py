"""sandbox_preamble — build the Python source the dispatcher sends as the
first executeCode call in each sandbox session.

## What the preamble does now

The preamble is executeCode call #1, run *before* any user code. Its
single job: confirm the base image's ``sitecustomize.py`` installed its
stdio redactor. If the wrapper is missing, the preamble fails loud and
the session aborts before user code runs on an unmitigated image.

Historically the preamble also read per-user OAuth tokens from Secrets
Manager and exported them into ``os.environ`` so user code could call
GitHub / Slack / Google APIs. That path was retired — agents that need
OAuth-ed work call composable-skill connector scripts, not a
credential-laden Python runtime. See docs/plans/2026-04-23-006-
refactor-sandbox-drop-required-connections-plan.md.

Version marker: the preamble emits a leading comment with the
``thinkwork_preamble_version`` the base image expects. Mismatch means
the image and the preamble shipped out-of-sync; the sitecustomize
check raises a loud error rather than silently running an untrusted
shape.
"""

# Current preamble shape. Bump when the contract with sitecustomize
# changes (e.g. new redactor API). v2 dropped OAuth token injection.
PREAMBLE_VERSION = 2


def build_preamble() -> str:
    """Return the Python source the dispatcher sends as executeCode call #1.

    The generated source:
      1. Imports ``sitecustomize`` (the base image installs it; importing
         is a no-op if the wrapper is active, ImportError otherwise).
      2. Confirms ``sitecustomize.installed()`` returns True — the
         stdio redactor is wrapping sys.stdout / sys.stderr before any
         user code runs. Identity compare (``is not True``) so a mock
         that returns a truthy non-True sentinel fails closed.
      3. Prints a readiness marker so the dispatcher knows call #1
         succeeded before sending call #2.
    """
    return """# thinkwork_preamble_version: 2
#
# This is executeCode call #1 — it must run to completion before any
# user code. The stdio redactor wrapping sys.stdout is installed by the
# base image's sitecustomize.py; this call confirms it's live.

try:
    import sitecustomize as _tw_sc
except ImportError as _tw_err:
    # The base image's sitecustomize.py is a hard dependency of the
    # sandbox. If it's missing, refuse to run — failing loud here is
    # better than running user code on an unmitigated image.
    raise RuntimeError(
        "sitecustomize not importable inside the sandbox; refusing to run"
    ) from _tw_err

if _tw_sc.installed() is not True:
    raise RuntimeError(
        "sitecustomize did not install its stdio wrapper; refusing to run"
    )

# Readiness marker — the dispatcher greps for this before proceeding.
print("__thinkwork_sandbox_ready__", flush=True)
"""
