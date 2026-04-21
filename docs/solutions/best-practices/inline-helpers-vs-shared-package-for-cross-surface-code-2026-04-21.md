---
module: packages/api + packages/lambda + packages/api/src/handlers
date: 2026-04-21
category: best-practices
problem_type: best_practice
component: service_object
severity: medium
related_components:
  - tooling
  - development_workflow
applies_when:
  - "The same ~30-line helper is needed in 2+ workspace packages"
  - "Extracting requires a new shared package or a circular/adjacent dep"
  - "The helper has a small, well-testable contract"
  - "The cost of drift can be enforced by a database constraint or contract test on each side"
tags:
  - refactoring
  - dry
  - workspace-packages
  - monorepo
  - yagni
  - skill-runs
---

# Inline helpers across packages when extraction is more expensive than triplication

## Context

The composable-skills plan (Units 4, 5, 6) landed the same ~30-line
helper trio (`canonicalizeForHash`, `hashResolvedInputs`, and an
`invokeComposition` / `invokeAgentcoreRunSkill` Lambda-invoke shape) in
three distinct surfaces:

- `packages/api/src/graphql/utils.ts` — called by the `startSkillRun`
  GraphQL mutation
- `packages/lambda/job-trigger.ts` — called by the `skill_run` trigger
  branch on scheduled-job fires
- `packages/api/src/handlers/skills.ts` — called by the
  `POST /api/skills/start` service-to-service REST endpoint

All three write rows into the same `skill_runs` table, whose
`uq_skill_runs_dedup_active` partial unique index depends on every
writer producing the identical SHA256 hash from identical canonical
JSON. Drift would silently break dedup — two writers with subtly
different canonicalization would insert side-by-side "different" rows
for what should be one logical run.

The naive DRY reflex says extract to a shared package. We chose
inlining 3× instead. This doc captures why, and the guardrails that
make inlining safe at this scale.

## Guidance

When you have identical code in N workspace packages, inline rather
than extract if **all three** of the following are true:

1. **The total size is small.** ~30 lines, not ~300. The cost of
   updating 3 copies is bounded by scanning 3 files; the cost of a
   new shared package compounds forever (deps, CI, versioning,
   publish order, import resolution).
2. **Extraction creates a structural cost you wouldn't otherwise
   pay.** Adding `@thinkwork/api` as a dependency of `@thinkwork/lambda`
   reversed the existing dependency direction — `lambda` functions
   are consumed by the `api` package via Lambda invokes, not the
   other way around. Extracting to a new `@thinkwork/shared-skill-runs`
   package would be correct but is non-trivial: new package.json,
   new tsconfig, workspace publish order, circular-dep audits.
3. **Drift has a database-level consequence you can pin.** The
   `skill_runs` dedup partial unique index is the forcing function —
   if any of the three implementations diverges, concurrent runs
   produce duplicate rows and an integration test detects it
   immediately. The contract is not enforced *by code sharing*; it's
   enforced *by the database schema the code feeds into*, plus tests
   on each side.

If any of those is false — the helper is big, extraction is cheap,
or drift would surface only in production — extract.

## Why This Matters

DRY is load-bearing wisdom in a single codebase. In a monorepo with
a half-dozen workspace packages and intentionally-one-way dependency
edges, DRY can push you into building infrastructure that carries its
own maintenance cost for years in exchange for saving one
three-minute edit every six months. The question to answer is not
"are we duplicating code?" It's: **"what does extraction cost, and
what forces drift to surface loud?"**

If extraction is cheap and drift would be silent, extract. If
extraction is expensive and drift is loud (DB constraint,
contract test, runtime fingerprint mismatch), inline and pin the
contract explicitly.

## When to Apply

This pattern fits when:

- The duplicated surface is on the order of tens of lines, not
  hundreds
- The receiving packages sit on opposite sides of a one-way
  dependency edge and introducing a new shared package requires
  restructuring that edge
- A database constraint, unique index, or integration test will
  break loudly if any copy diverges from the others
- Each copy has unit tests that exercise the contract (hash shape,
  envelope shape, etc.)

This pattern **does not** fit when:

- The duplicated logic is complex enough to be a subtle source of
  bugs (e.g., cryptographic primitives, timezone math, parsers)
- Downstream systems don't enforce the contract
- The number of copies is likely to grow to 5+
- Any one copy lives in a package that already depends on a plausible
  shared-helpers location

## Examples

**The contract we inlined (all three files verbatim-identical, by
design):**

```ts
function canonicalizeForHash(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeForHash(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`,
  );
  return `{${entries.join(",")}}`;
}

function hashResolvedInputs(resolvedInputs: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalizeForHash(resolvedInputs)).digest("hex");
}
```

Tests on all three sides pin the invariants: key-sorted JSON,
arrays preserve order, SHA256. The `skill_runs` partial unique
index on `(tenant_id, invoker_user_id, skill_id, resolved_inputs_hash)
WHERE status = 'running'` is the forcing function — identical inputs
across the three surfaces must produce identical hashes or dedup
breaks.

**Guardrails we added:**

- A block comment at the top of each inlined helper block explicitly
  names the other two locations and the shared contract:
  ```ts
  // Intentionally inlined rather than imported — packages/lambda
  // doesn't depend on the API package and adding that dep for ~30
  // lines of pure-logic helpers isn't worth the coupling. The two
  // implementations share a documented contract: canonicalization
  // is key-sorted JSON (arrays preserve order), hash is SHA256.
  // If either drifts, the dedup partial unique index collapses —
  // tests on both sides guard.
  ```
- Each copy has a hash-shape test (e.g., same input → same output
  as a hardcoded fixture), so a drift on any one side fails CI on
  that side immediately.

**If you find yourself wanting a 4th copy:** that's the signal to
extract. Three was defensible; four means the helper is becoming
a library and the extraction cost is now less than the maintenance
cost.

## Related

- `docs/solutions/best-practices/defer-integration-tests-until-shared-harness-2026-04-21.md`
  — related "defer the shared infrastructure until it earns itself"
  instinct applied to test harnesses.
- auto memory `project_automations_eb_provisioning` — the
  `scheduled_jobs → job-schedule-manager → AWS Scheduler →
  job-trigger → wakeups` flow is what routes the `skill_run` trigger
  type through `packages/lambda/job-trigger.ts`, one of the three
  inlining sites.
