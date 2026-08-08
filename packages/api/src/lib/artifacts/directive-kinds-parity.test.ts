/**
 * Drift guards for the hand-maintained seams a new `tw:` directive kind has to
 * touch (THINK-685). See
 * `docs/solutions/architecture-patterns/new-tw-directive-kind-checklist.md`.
 *
 * Three mechanical mirrors of `DEFAULT_REGISTRY` used to be hand-typed lists
 * that failed silently when a kind was added:
 *  1. the plate exemplar snippet library (now derived from each spec),
 *  2. `PLATE_DIRECTIVE_KINDS` in apps/web (now a checked-in generated file),
 *  3. the email delivery renderer's if-chain (now pinned by an allowlist).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENERATED_DIRECTIVE_KINDS_PATH,
  REGENERATE_COMMAND,
  renderDirectiveKindsModule,
} from "../../../scripts/generate-directive-kinds.js";
import {
  DELIVERY_FALLBACK_OK,
  DELIVERY_RENDERED_KINDS,
  DIRECTIVE_FALLBACK_TEXT,
  renderDirectiveForEmail,
} from "../artifact-delivery.js";
import {
  DIRECTIVE_EXEMPLAR_SNIPPETS,
  DIRECTIVE_KINDS,
} from "./document-directives.js";

/** Body of an exemplar snippet, fence lines stripped. */
function exemplarBody(kind: string): string {
  const lines = DIRECTIVE_EXEMPLAR_SNIPPETS[kind].split("\n");
  return lines.slice(1, -1).join("\n");
}

describe("exemplar snippets derive from the directive registry", () => {
  it("covers every registry kind, in registry order", () => {
    expect(Object.keys(DIRECTIVE_EXEMPLAR_SNIPPETS)).toEqual([
      ...DIRECTIVE_KINDS,
    ]);
  });

  // Byte-for-byte pin of the snippets that lived in the hand-maintained
  // EXEMPLAR_DIRECTIVE_SNIPPETS map in plate-registry.ts before THINK-685.
  it("emits the pre-refactor snippets byte-for-byte", () => {
    expect(DIRECTIVE_EXEMPLAR_SNIPPETS.stats).toBe(`\`\`\`tw:stats
items:
  - { value: 12, label: initiatives on track }
  - { value: "94%", label: renewal rate }
  - { value: "+18%", label: quarter over quarter }
\`\`\``);
    expect(DIRECTIVE_EXEMPLAR_SNIPPETS["verdict-grid"])
      .toBe(`\`\`\`tw:verdict-grid
cards:
  - { question: Overall health, answer: Strong, note: All commitments met this period, tone: acc }
  - { question: Attention needed, answer: One item, note: Renewal paperwork pending signature, tone: warn }
\`\`\``);
    expect(DIRECTIVE_EXEMPLAR_SNIPPETS.timeline).toBe(`\`\`\`tw:timeline
items:
  - { label: Kickoff, caption: Goals and owners locked, date: Week 1 }
  - { label: Rollout, caption: Phased team onboarding, current: true }
  - { label: Full adoption, date: Q4 }
\`\`\``);
    expect(DIRECTIVE_EXEMPLAR_SNIPPETS.chart).toBe(`\`\`\`tw:chart
type: bar
title: Quarterly momentum
qualifier: closed items per month
series:
  - { label: Month 1, value: 14 }
  - { label: Month 2, value: 18 }
  - { label: Month 3, value: 23 }
caption: Delivery pace accelerated through the quarter.
\`\`\``);
  });
});

describe("apps/web PLATE_DIRECTIVE_KINDS mirror is generated + fresh", () => {
  it("matches the checked-in generated file byte-for-byte", () => {
    const onDisk = readFileSync(GENERATED_DIRECTIVE_KINDS_PATH, "utf8");
    const expected = renderDirectiveKindsModule();
    expect(
      onDisk,
      `apps/web directive-kind mirror is stale. Regenerate with:\n  ${REGENERATE_COMMAND}`,
    ).toBe(expected);
  });
});

describe("email delivery renderer covers every directive kind", () => {
  it("handles (or explicitly waives) every registry kind", () => {
    const handled = new Set<string>([
      ...DELIVERY_RENDERED_KINDS,
      ...DELIVERY_FALLBACK_OK,
    ]);
    const missing = DIRECTIVE_KINDS.filter((k) => !handled.has(k));
    expect(
      missing,
      `packages/api/src/lib/artifact-delivery.ts renders directives for email with an explicit if-chain. ` +
        `These kinds would silently downgrade to the generic "open the live report" block in delivered email: ` +
        `${missing.join(", ")}. Add a branch to renderDirectiveForEmail and list the kind in DELIVERY_RENDERED_KINDS, ` +
        `or waive it (with a reason) in DELIVERY_FALLBACK_OK.`,
    ).toEqual([]);
  });

  it("actually renders non-fallback email HTML for each claimed kind", () => {
    for (const kind of DELIVERY_RENDERED_KINDS) {
      // "analysis" is not a registry kind — it reuses the chart branch.
      const body = exemplarBody(kind === "analysis" ? "chart" : kind);
      const rendered = renderDirectiveForEmail(kind, body);
      expect(
        rendered.text,
        `tw:${kind} fell through to the email fallback`,
      ).not.toBe(DIRECTIVE_FALLBACK_TEXT);
    }
  });
});
