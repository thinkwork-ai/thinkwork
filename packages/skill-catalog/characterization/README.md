# Skill characterization harness

Scaffolding for the deterministic half of the V1 agent-architecture plan's
pre-migration equivalence gate (plan §U7).

## When to use this vs. shadow dispatch

| Skill type                                                               | Coverage                                          | File                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------- |
| Deterministic script skills (`run(**args) -> dict` with pure-ish inputs) | Byte-equal fixture comparison                     | this directory                         |
| LLM-mediated / composition / context skills                              | 60-day shadow-traffic A/B with divergence metrics | `container-sources/shadow_dispatch.py` |

Deterministic coverage is cheap — one test process, no sandbox
roundtrip, no LLM call. It catches the "skill authors accidentally
changed output shape during migration" class. Shadow coverage catches
semantic drift in LLM responses that byte-equal comparison would flag
as divergent on every call.

## Adding a fixture for a slug

Each U8 per-skill migration PR should land:

```
fixtures/<slug>/
  inputs.json    # kwargs passed to entrypoint.run(**inputs)
  golden.json    # expected return value
```

Capture the golden by running the pre-migration skill once against
representative inputs and writing the exact output to `golden.json`.
The harness normalises floats to 9 decimal digits so platform noise
doesn't flake; everything else must match byte-for-byte.

## Running the harness

```bash
# Check every fixture
uv run python packages/skill-catalog/characterization/deterministic_harness.py

# One slug
uv run python packages/skill-catalog/characterization/deterministic_harness.py --slug sales-prep

# Regenerate goldens (requires both flags)
uv run python packages/skill-catalog/characterization/deterministic_harness.py --regenerate --confirm
```

Exit 0 = match; exit 1 = at least one mismatch; exit 2 = arg error.

## Regeneration discipline

`--regenerate` without `--confirm` refuses. This is the circuit breaker
that prevents a lazy PR from papering over a regression. Use it only
when you've looked at the diff and decided the new output is correct.
The PR commit message for a regenerate MUST cite the behavioural change
that justifies the new golden.
