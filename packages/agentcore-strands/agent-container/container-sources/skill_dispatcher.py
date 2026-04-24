"""Unified dispatcher for every skill-with-scripts invocation.

This replaces the pre-V1 branching (the retired orchestrator module
plus the execution-type switches in ``run_skill_dispatch``) with a
single function: load a skill bundle, run its ``entrypoint.run`` inside
an AgentCore Code Interpreter session, parse the JSON it prints.

## Contract with skill authors

Every skill-with-scripts ships this shape on disk:

    packages/skill-catalog/<slug>/
      SKILL.md           # or skill.yaml pre-migration
      scripts/
        entrypoint.py    # module-level `def run(**kwargs) -> dict:`
      references/        # optional, copied alongside

``run`` receives the args the model passed to ``Skill(name=<slug>, args={...})``
as kwargs. The return value must be JSON-serialisable.

## Security invariants enforced here

* **SI-2 — args are data, never code.** Arguments travel into the sandbox
  via ``writeFiles([{path: "_args.json", text: json.dumps(args)}])``. The
  ``executeCode`` string is a fixed template that reads ``_args.json`` and
  calls ``run(**args)``. Model-controlled values are never embedded into the
  executed Python source.

* **SI-6 — module namespace reset between invocations.** Before each call
  we purge ``sys.modules['scripts.<slug>.*']`` and
  ``importlib.invalidate_caches()`` inside the session. A skill that
  monkey-patches a builtin or module attribute cannot leak that mutation
  into the next skill running in the same pooled session.

SI-3 (user-scoped pool key) is enforced in ``skill_session_pool.py``.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from skill_session_pool import PoolKey, SessionHandle, SkillSessionPool

logger = logging.getLogger(__name__)

# Plan §Key Technical Decisions — headroom over the max observed depth (3)
# in the current corpus, enforced so runaway recursion can't melt a turn.
MAX_NESTED_DEPTH = 5
# Plan §Key Technical Decisions — per-turn total budget; catches
# sequential-loop abuse that a depth cap wouldn't.
MAX_CALLS_PER_TURN = 50

# The ``executeCode`` template. Never embeds user-controlled values.
# ``{slug}`` comes from the catalog, not from the model; it's validated
# against the dispatch allowlist before we get here.
_EXEC_TEMPLATE = (
    "import importlib, json, sys\n"
    "# SI-6: purge any leftover scripts.<slug>.* modules from a prior call.\n"
    "for _name in [m for m in list(sys.modules.keys()) if m.startswith('scripts.{slug}.') or m == 'scripts.{slug}']:\n"
    "    sys.modules.pop(_name, None)\n"
    "importlib.invalidate_caches()\n"
    "# SI-2: args are loaded from a data file, not interpolated into this string.\n"
    "with open('_args.json', 'r') as _fh:\n"
    "    _args = json.load(_fh)\n"
    "from scripts.{slug}.entrypoint import run as _run\n"
    "_result = _run(**_args)\n"
    "print(json.dumps(_result))\n"
)


class SkillBundle(Protocol):
    """Minimal shape the dispatcher needs from a loaded skill bundle."""

    slug: str
    timeout_s: int

    def files_for_interpreter(self) -> list[dict[str, str]]:
        """Return ``[{path, text}, ...]`` pairs for ``writeFiles``."""
        ...


class SkillBundleLoader(Protocol):
    """Catalog shim — abstract so tests can inject fixtures."""

    def load_bundle(self, slug: str) -> SkillBundle: ...


class SandboxRunner(Protocol):
    """Whatever can execute code in a pooled session. Tests inject fakes."""

    async def write_files(self, handle: SessionHandle, files: list[dict[str, str]]) -> None: ...

    async def execute_code(
        self, handle: SessionHandle, code: str, *, timeout_s: int
    ) -> dict[str, Any]: ...


class SkillDispatchError(Exception):
    """Base for dispatcher-originated errors. Every subclass serialises to
    the same ``{"status": "failed", "error_kind": <class>, ...}`` shape."""


class SkillNotFound(SkillDispatchError): ...


class SkillOutputParseError(SkillDispatchError):
    def __init__(self, message: str, stdout: str) -> None:
        super().__init__(message)
        self.stdout = stdout


class SkillTimeout(SkillDispatchError): ...


class SkillExecutionError(SkillDispatchError):
    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


class SkillDepthExceeded(SkillDispatchError): ...


class SkillTurnBudgetExceeded(SkillDispatchError): ...


@dataclass
class TurnCounters:
    """Per-turn budgets. One instance lives for the duration of a model turn."""

    depth: int = 0
    total: int = 0
    # Kept so tests can see what the dispatcher saw, even when limits trip.
    history: list[str] = field(default_factory=list)

    def child(self) -> "TurnCounters":
        """Return a counter view for a nested Skill() call.

        ``depth`` rises for the child; ``total`` is shared so sequential
        and nested abuse both hit the same ceiling.
        """
        return TurnCounters(depth=self.depth + 1, total=self.total, history=self.history)


@dataclass
class DispatchResult:
    status: str  # 'ok' | 'failed'
    result: Any = None
    error_kind: str | None = None
    error_message: str | None = None
    stdout: str | None = None
    stderr: str | None = None
    duration_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"status": self.status}
        if self.result is not None:
            out["result"] = self.result
        if self.error_kind is not None:
            out["error_kind"] = self.error_kind
        if self.error_message is not None:
            out["error_message"] = self.error_message
        if self.stdout is not None:
            out["stdout"] = self.stdout
        if self.stderr is not None:
            out["stderr"] = self.stderr
        if self.duration_ms is not None:
            out["duration_ms"] = self.duration_ms
        return out


async def dispatch_skill_script(
    *,
    tenant_id: str,
    user_id: str,
    skill_slug: str,
    args: dict[str, Any],
    environment: str,
    pool: SkillSessionPool,
    catalog: SkillBundleLoader,
    runner: SandboxRunner,
    counters: TurnCounters,
    on_audit: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> DispatchResult:
    """Run ``skill_slug`` inside a pooled session with the provided args.

    See module docstring for the security invariants this honours.
    """
    # --- Budget gates --------------------------------------------------
    if counters.depth > MAX_NESTED_DEPTH:
        raise SkillDepthExceeded(
            f"nested Skill() depth {counters.depth} > max {MAX_NESTED_DEPTH}"
        )
    if counters.total >= MAX_CALLS_PER_TURN:
        raise SkillTurnBudgetExceeded(
            f"per-turn Skill() calls {counters.total} >= max {MAX_CALLS_PER_TURN}"
        )
    counters.total += 1
    counters.history.append(skill_slug)

    # --- Bundle load ---------------------------------------------------
    try:
        bundle = catalog.load_bundle(skill_slug)
    except KeyError as e:
        raise SkillNotFound(f"skill '{skill_slug}' not in catalog") from e

    # --- Session + file staging ---------------------------------------
    key: PoolKey = (tenant_id, user_id, environment)
    handle = await pool.acquire(key)
    start = time.monotonic()
    try:
        files = list(bundle.files_for_interpreter())
        # SI-2: args serialise via json.dumps, not repr. A value like
        # "__import__('os').system('...')" is a *string* here; the
        # executeCode template json.loads it back to a string and passes
        # it to run() as a string.
        files.append({"path": "_args.json", "text": json.dumps(args)})
        await runner.write_files(handle, files)

        code = _EXEC_TEMPLATE.format(slug=skill_slug)
        timeout_s = bundle.timeout_s or 60

        raw = await runner.execute_code(handle, code, timeout_s=timeout_s)
        stdout = raw.get("stdout", "")
        stderr = raw.get("stderr", "")
        exit_code = int(raw.get("exit_code", 0))
        timed_out = bool(raw.get("timed_out", False))

        if timed_out:
            raise SkillTimeout(
                f"skill '{skill_slug}' timed out after {timeout_s}s"
            )
        if exit_code != 0:
            raise SkillExecutionError(
                f"skill '{skill_slug}' exited {exit_code}", stderr=stderr
            )

        # Parse the single JSON line ``print(json.dumps(result))`` emitted.
        # Tolerate leading/trailing whitespace + stray debug prints by
        # extracting the last non-empty line.
        parsed = _parse_json_stdout(stdout, slug=skill_slug)

        duration_ms = int((time.monotonic() - start) * 1000)
        if on_audit is not None:
            await on_audit(
                {
                    "skill_slug": skill_slug,
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "environment": environment,
                    "duration_ms": duration_ms,
                    "status": "ok",
                }
            )
        return DispatchResult(
            status="ok",
            result=parsed,
            stdout=stdout,
            stderr=stderr,
            duration_ms=duration_ms,
        )
    except SkillDispatchError as e:
        duration_ms = int((time.monotonic() - start) * 1000)
        if on_audit is not None:
            await on_audit(
                {
                    "skill_slug": skill_slug,
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "environment": environment,
                    "duration_ms": duration_ms,
                    "status": "failed",
                    "error_kind": type(e).__name__,
                    "error_message": str(e),
                }
            )
        raise
    finally:
        await handle.release()


def _parse_json_stdout(stdout: str, *, slug: str) -> Any:
    """Pull the last non-empty stdout line and json.loads it.

    Stray prints from a skill's helper modules are common during
    development; requiring strict single-line output would cause
    false-failure noise. The entrypoint contract is still
    ``print(json.dumps(result))`` once; we just allow extras above.
    """
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    if not lines:
        raise SkillOutputParseError(
            f"skill '{slug}' produced no stdout", stdout=stdout
        )
    last = lines[-1]
    try:
        return json.loads(last)
    except json.JSONDecodeError as e:
        raise SkillOutputParseError(
            f"skill '{slug}' last stdout line was not JSON: {e.msg}",
            stdout=stdout,
        ) from e


__all__ = [
    "MAX_CALLS_PER_TURN",
    "MAX_NESTED_DEPTH",
    "DispatchResult",
    "SandboxRunner",
    "SkillBundle",
    "SkillBundleLoader",
    "SkillDepthExceeded",
    "SkillDispatchError",
    "SkillExecutionError",
    "SkillNotFound",
    "SkillOutputParseError",
    "SkillTimeout",
    "SkillTurnBudgetExceeded",
    "TurnCounters",
    "dispatch_skill_script",
]
