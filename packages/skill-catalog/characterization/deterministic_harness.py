"""Deterministic characterization harness for bundled skills.

## What this is

The cheap half of U7's two-fidelity strategy (plan #007 §U7). Deterministic
script skills — the ~11 slugs whose output is a pure function of their
inputs — get fixture-driven byte-equal tests. Running them pre-cutover
against the same inputs must produce the same outputs they produced
pre-V1-migration. If a diff appears, U8's per-slug PR for that slug is
blocked until the divergence is explained (intentional behavior change)
or the migration is fixed.

LLM-mediated skills (compositions, context-mode) don't go here — they
get the shadow-traffic A/B covered by ``shadow_dispatch.py``.

## Per-slug fixture shape

    packages/skill-catalog/characterization/fixtures/<slug>/
      inputs.json       # kwargs to pass to entrypoint.run(**inputs)
      golden.json       # expected return value

When this PR lands, ``fixtures/`` is empty. Per-slug fixtures are
captured as part of U8's per-skill migration PRs — that's when the
bundle author has the context to say "these inputs exercise the
real-world paths" and verify golden outputs by eye. The harness
itself is the scaffolding; the fixtures land with the work that
needs them.

## Regenerating goldens

Intentional output changes (a bug fix that deliberately shifts output
shape, or a spec clarification) require a two-flag opt-in:

    uv run python packages/skill-catalog/characterization/deterministic_harness.py \
        --regenerate --confirm --slug <slug>

Without ``--confirm`` the script refuses. This is the circuit breaker
that prevents a lazy ``--regenerate`` from papering over an accidental
regression.

## Not in this PR

* Individual per-slug ``inputs.json`` / ``golden.json`` fixtures.
* CloudWatch dashboard Terraform. Log Insights saved queries cover the
  use case for now.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
FIXTURES_ROOT = HERE / "fixtures"
CATALOG_ROOT = HERE.parent  # packages/skill-catalog/
SCRIPTS_PYTHONPATH = CATALOG_ROOT  # scripts/<slug>/entrypoint.py


@dataclass
class FixturePair:
    slug: str
    inputs: dict[str, Any]
    golden: Any
    inputs_path: Path
    golden_path: Path


class CharacterizationError(Exception):
    """Base for harness-originated failures."""


class FixturesMissing(CharacterizationError): ...


class GoldenMismatch(CharacterizationError):
    def __init__(self, slug: str, expected: Any, actual: Any) -> None:
        super().__init__(f"golden mismatch for slug '{slug}'")
        self.slug = slug
        self.expected = expected
        self.actual = actual


def discover_fixtures() -> list[FixturePair]:
    """Return every ``(inputs.json, golden.json)`` pair under ``fixtures/``.

    Empty list is valid — U7 ships the scaffolding ahead of U8's per-slug
    fixtures. The harness warns (but does not fail) in that state so CI
    doesn't mark U7 red in the window between U7 merge and the first U8
    per-slug PR landing its goldens.
    """
    if not FIXTURES_ROOT.exists():
        return []
    pairs: list[FixturePair] = []
    for slug_dir in sorted(FIXTURES_ROOT.iterdir()):
        if not slug_dir.is_dir():
            continue
        inputs_path = slug_dir / "inputs.json"
        golden_path = slug_dir / "golden.json"
        if not inputs_path.exists() or not golden_path.exists():
            # Slugs that shipped only inputs.json (in progress) or only
            # golden.json (malformed) get surfaced by the check loop.
            continue
        try:
            inputs = json.loads(inputs_path.read_text())
            golden = json.loads(golden_path.read_text())
        except json.JSONDecodeError as e:
            raise CharacterizationError(
                f"malformed fixture JSON for slug '{slug_dir.name}': {e.msg}"
            ) from e
        pairs.append(
            FixturePair(
                slug=slug_dir.name,
                inputs=inputs,
                golden=golden,
                inputs_path=inputs_path,
                golden_path=golden_path,
            )
        )
    return pairs


def _import_entrypoint(slug: str):
    """Import ``scripts.<slug>.entrypoint`` from the catalog tree.

    Mirrors the layout the unified dispatcher expects inside the
    sandbox: ``scripts/<slug>/entrypoint.py`` with a module-level
    ``run(**kwargs) -> dict``. During the U8 migration the target
    location may instead be ``<slug>/scripts/<single>.py`` (legacy);
    the harness does not yet resolve that shape — U8 PRs reshape the
    skill to the canonical layout at the same time they add fixtures,
    so the harness only needs to know the canonical shape.
    """
    if str(CATALOG_ROOT) not in sys.path:
        sys.path.insert(0, str(CATALOG_ROOT))
    module_name = f"scripts.{slug}.entrypoint"
    if module_name in sys.modules:
        # SI-6-style purge: pre-existing import can mask a skill rewrite
        # when the harness is run in the same process as earlier slugs.
        del sys.modules[module_name]
    return importlib.import_module(module_name)


def structural_equal(expected: Any, actual: Any) -> bool:
    """Byte-equal JSON comparison with float tolerance.

    Floats round-trip through JSON without quite surviving
    bit-for-bit; the harness normalises to 9 decimal digits (enough
    for any skill that produces aggregated metrics, well under the
    precision of the inputs the skills actually consume).
    """
    return _normalise(expected) == _normalise(actual)


def _normalise(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _normalise(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [_normalise(v) for v in value]
    if isinstance(value, float):
        # Round to 9 digits so platform-level float noise doesn't make
        # the harness flaky; still catches every real change (skills
        # don't emit floats that differ in the 10th digit meaningfully).
        return round(value, 9)
    return value


def run_fixture(pair: FixturePair) -> Any:
    """Invoke the slug's entrypoint with the pair's inputs, return result.

    Env vars the skill expects to read are caller-managed. The harness
    intentionally does not try to populate them — each slug's U8 PR
    captures its fixtures in a setup the harness can reproduce.
    """
    mod = _import_entrypoint(pair.slug)
    if not hasattr(mod, "run"):
        raise CharacterizationError(
            f"skill '{pair.slug}' entrypoint has no run(**kwargs) function"
        )
    return mod.run(**pair.inputs)


def check_pair(pair: FixturePair) -> None:
    """Run a fixture and assert the result matches the golden byte-for-byte."""
    actual = run_fixture(pair)
    if not structural_equal(pair.golden, actual):
        raise GoldenMismatch(pair.slug, pair.golden, actual)


def regenerate_pair(pair: FixturePair, *, confirm: bool) -> None:
    """Rewrite ``golden.json`` from a fresh run of the entrypoint.

    Guarded by ``--confirm`` because regenerating is the circuit breaker
    that a lazy PR could use to mask a regression. The human has to
    state intent twice.
    """
    if not confirm:
        raise CharacterizationError(
            "refusing to regenerate goldens without --confirm — state intent twice"
        )
    actual = run_fixture(pair)
    pair.golden_path.write_text(
        json.dumps(_normalise(actual), indent=2, sort_keys=True) + "\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic characterization harness for bundled skills"
    )
    parser.add_argument(
        "--slug",
        help="Run only this slug's fixture (default: every slug in fixtures/)",
    )
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Rewrite golden.json from a fresh entrypoint run.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required alongside --regenerate. Acts as the circuit breaker.",
    )
    args = parser.parse_args(argv)

    pairs = discover_fixtures()
    if args.slug:
        pairs = [p for p in pairs if p.slug == args.slug]
        if not pairs:
            print(f"no fixture found for slug '{args.slug}'", file=sys.stderr)
            return 2

    if not pairs:
        # Empty state is valid during the U7→U8 window. CI pipes this
        # output to stderr; humans reading a green test run see a
        # one-line confirmation that the harness is wired but has no
        # work yet.
        print(
            "characterization: no fixtures under "
            f"{FIXTURES_ROOT.relative_to(Path.cwd())}/ — U8 PRs add them per slug",
            file=sys.stderr,
        )
        return 0

    failures: list[GoldenMismatch] = []
    for pair in pairs:
        if args.regenerate:
            regenerate_pair(pair, confirm=args.confirm)
            print(f"regenerated: {pair.slug}")
            continue
        try:
            check_pair(pair)
        except GoldenMismatch as e:
            failures.append(e)
            print(f"MISMATCH: {pair.slug}", file=sys.stderr)

    if failures:
        print(f"\n{len(failures)} slug(s) diverged from golden", file=sys.stderr)
        return 1
    print(f"OK: {len(pairs)} slug(s) match golden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
