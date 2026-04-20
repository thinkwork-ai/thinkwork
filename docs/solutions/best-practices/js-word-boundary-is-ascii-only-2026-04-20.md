---
title: JavaScript `\b` is ASCII-only even under `/u` — use a Unicode-aware lookahead
date: 2026-04-20
category: best-practices
module: regex
problem_type: best_practice
component: tooling
severity: low
applies_when:
  - Writing a regex with `/u` flag that uses `\p{L}` or `\p{Lu}` Unicode property classes
  - The input string may contain non-ASCII letters (accented, CJK, etc.)
  - The regex uses `\b` as a word-boundary assertion
  - You care that the match captures the FULL Unicode word, not just its ASCII prefix
tags:
  - javascript
  - typescript
  - regex
  - unicode
  - gotcha
related_components:
  - packages/api/src/lib/wiki/parent-expander.ts
---

# JavaScript `\b` is ASCII-only even under `/u` — use a Unicode-aware lookahead

## Context

While fixing `extractCityFromSummary` in the 2026-04-20 wiki-parent-linker work (PR #311), the regex `/\b(?:in|at|on|near|from|of)\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?)(?:,\s*[A-Z]{2,4})?\b/u` truncated `"Bogotá"` to `"Bogot"` and preserved `"Montréal"` fully. The accented `á` at the end was dropped; the accented `é` in the middle survived.

The surprise: even with the `/u` flag on, and `\p{L}` (Unicode letter) doing the heavy lifting, the trailing `\b` still used the ASCII-only definition of "word character" (`[A-Za-z0-9_]`). That's fine for `"é"` mid-string (the `\p{L}+` greedy consumed it as part of the match body), but fatal for `"á"` at the end: `\b` saw `"t"` (ASCII word) adjacent to `"á"` (non-word-by-ASCII-rules), decided that was a valid word boundary, and the engine backtracked to the shorter match that let `\b` succeed.

Diagnosed by dropping `\b` and comparing:

```js
const s = "Cafe in Bogotá.";
// With \b: ["in Bogot", "Bogot"]   ← á stripped
// Without: ["in Bogotá", "Bogotá"] ← match succeeds cleanly
```

## Guidance

**Never rely on `\b` to anchor a Unicode-aware regex.** Even when the rest of the pattern uses `\p{L}`, `\p{Lu}`, `\p{Lo}`, etc., `\b` stays ASCII-only. Replace trailing `\b` with an explicit Unicode lookahead:

```ts
// Wrong — `\b` truncates "Bogotá" to "Bogot"
const re = /\p{Lu}\p{L}+\b/u;

// Right — explicit non-letter-or-end lookahead
const re = /\p{Lu}\p{L}+(?=[^\p{L}]|$)/u;
```

The lookahead `(?=[^\p{L}]|$)` says "the next character is either a non-letter (Unicode-aware) or end of string." Equivalent semantic to what you thought `\b` meant, but actually respects Unicode.

For a leading boundary, `\b` often still works because the preceding character is ASCII (preposition, comma, space). If the input might have a non-ASCII char before the match, use `(?:^|[^\p{L}])` on the left side too.

## Why This Matters

This is a silent-correctness bug. No exception, no visible error — just a quieter output. In the parent-linker case, the truncation produced candidate titles like `"Bogot"` that never matched any existing page (similarity to `"Bogotá, Colombia"` is ~0.30, well below any useful threshold), so the truncated candidates contributed zero links and nobody noticed until the audit script dumped the candidate list.

The specific failure mode — `\p{L}+\b` stripping trailing accents but preserving mid-string ones — is hard to detect from spot-checks: Montréal, Michaël, François all pass because the accented char isn't last. Bogotá, Málaga, São José all fail. Any codebase indexing a list of cities, places, names, or tags with mixed accent positions will have a silent accuracy gap.

Node REPL test in ~30 seconds (`echo '…' | node -e '…'`) conclusively diagnoses it once you suspect the gotcha. The trap is that `\p{L}` + `/u` LOOKS Unicode-aware, so it's easy to assume the whole regex is.

## When to Apply

- Writing any regex that extracts names, cities, tags, identifiers, or other natural-language tokens from user-generated or internationalized text.
- The regex uses `\p{L}` / `\p{Lu}` / `\p{N}` Unicode property classes.
- You're tempted to end the match with `\b` or `\B`.
- Reviewing a PR that adds a Unicode regex to JS/TS — reject `\b` boundaries, recommend the explicit `(?=[^\p{L}]|$)` lookahead.
- You notice a data-quality issue where accented entries look truncated or mismatched.

## Examples

### Before (the bug that shipped for ~3 weeks)

```ts
function extractCityFromSummary(summary: string): string | null {
  const re = /\b(?:in|at|on|near|from|of)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)(?:,\s*[A-Z]{2})?\b/;
  const match = summary.match(re);
  return match?.[1]?.trim() ?? null;
}

extractCityFromSummary("Restaurant in Bogotá.");
// → "Bogot"   ❌ accent stripped
```

### After (PR #311)

```ts
function extractCityFromSummary(summary: string): string | null {
  // `\p{Lu}\p{L}+` catches capitalized Unicode letter runs. The trailing
  // lookahead is deliberately `(?=[^\p{L}]|$)` — a bare `\b` anchors on
  // ASCII word-chars even under `/u`, which truncated "Bogotá" to
  // "Bogot" before this fix.
  const re = /\b(?:in|at|on|near|from|of)\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?)(?:,\s*[A-Z]{2,4})?(?=[^\p{L}]|$)/u;
  const match = summary.match(re);
  return match?.[1]?.trim() ?? null;
}

extractCityFromSummary("Restaurant in Bogotá.");
// → "Bogotá"   ✓ full match
```

### Diagnostic REPL snippet

When you suspect a Unicode regex is truncating on accents:

```ts
const re_with_b = /\p{Lu}\p{L}+\b/u;
const re_with_lookahead = /\p{Lu}\p{L}+(?=[^\p{L}]|$)/u;

const cases = ["Bogotá", "Montréal", "São Paulo", "München"];
for (const c of cases) {
  console.log(c, "\\b:", c.match(re_with_b)?.[0], "lookahead:", c.match(re_with_lookahead)?.[0]);
}
// Bogotá    \b: Bogot    lookahead: Bogotá
// Montréal  \b: Montréal lookahead: Montréal    ← mid-string accent, both work
// São Paulo \b: São      lookahead: São
// München   \b: M        lookahead: München     ← ü fails \b immediately
```

## Related

- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — the sibling compound doc from the same investigation. This `\b` bug was one of the two upstream extractor bugs the audit uncovered.
- PR [#311](https://github.com/thinkwork-ai/thinkwork/pull/311) — the fix.
- MDN: [RegExp `\b` assertion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Word_boundary_assertion) — documents the ASCII-only behavior but easy to miss.
