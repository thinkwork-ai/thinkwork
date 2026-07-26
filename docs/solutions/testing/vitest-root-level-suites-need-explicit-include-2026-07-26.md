---
module: packages/api
date: 2026-07-26
last_updated: 2026-07-26
category: testing
problem_type: process_gap
component: api
severity: medium
related_components:
  - vitest_config
applies_when:
  - "Adding a test file beside a Lambda entry point at the root of packages/api"
  - "A new suite reports no failures and you have not confirmed it ran"
  - "Auditing whether a package's test globs actually cover its test files"
tags:
  - vitest
  - testing-gaps
  - silent-skip
  - api
---

# Root-level API suites are skipped unless named in vitest.config.ts

## Context

`packages/api/vitest.config.ts` includes tests by glob:

```ts
include: [
  "src/**/*.test.ts",
  "scripts/**/*.test.ts",
  "test/integration/**/*.test.ts",
  "../../seeds/eval-test-cases/__tests__/**/*.test.ts",
  // The knowledge-base Lambda entries live at the package root (not src/);
  // their suites sit beside them.
  "knowledge-base-manager.test.ts",
  "knowledge-base-files.test.ts",
],
```

Two Lambda entry points live at the package **root** rather than under `src/`,
so no glob covers them. Each root-level suite is listed by name, one line per
file.

## The trap

A new root-level test file that is not added to that list **does not run**, and
nothing says so:

- `pnpm test` exits 0.
- The file count and pass count go up by zero, which nobody notices.
- CI is green.
- The suite reports no failures, because it never executed.

This is worse than a failing test. A failing test gets fixed; a suite that
silently never runs looks like coverage that does not exist, and the next person
to touch that Lambda trusts it.

Discovered on 2026-07-26 while adding `knowledge-base-files.test.ts` for the
THINK-345 manifest widening. The suite was written, the config was not touched,
and the only reason it ran at all was noticing the enumerated list while reading
the config for something else.

## Adding a root-level suite

1. Write the test beside its entry point.
2. Add its filename to `include` in `packages/api/vitest.config.ts`.
3. Confirm it actually ran — check the file and test counts, not just the exit
   code:

   ```bash
   cd packages/api && npx vitest run <name>.test.ts
   # Test Files  1 passed (1)
   # Tests       6 passed (6)
   ```

   `Test Files 0 passed (0)` with exit code 0 is the failure mode. Treat a zero
   file count as a hard error, never as "nothing to run."

## The general shape

Any test config that enumerates files by name instead of matching them by
pattern has this property: the default for a new file is _excluded_, and
exclusion is silent. When you see a hand-maintained list in a test config, adding
to it is part of adding a test — and the verification is a nonzero file count,
not a green run.
