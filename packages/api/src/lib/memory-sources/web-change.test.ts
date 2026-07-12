/**
 * Web change classification (THINK-193 U5): cosmetic churn must not mint
 * new evidence editions; material changes must.
 */

import { describe, expect, it } from "vitest";

import {
  classifyWebChange,
  normalizeWebMarkdownForComparison,
} from "./web-change.js";

const PAGE = `# Acme Pricing

Our plans start at $49/month.

- Starter: $49
- Team: $199

Last updated March 3, 2026
© 2026 Acme Inc.
1,234 views`;

describe("normalizeWebMarkdownForComparison", () => {
  it("collapses whitespace and drops empty lines deterministically", () => {
    const a = normalizeWebMarkdownForComparison("a   b\n\n\n c\t d\n");
    expect(a).toBe("a b\nc d");
    expect(normalizeWebMarkdownForComparison("a   b\n\nc  d")).toBe(a);
  });

  it("strips date/counter/copyright boilerplate lines", () => {
    const normalized = normalizeWebMarkdownForComparison(PAGE);
    expect(normalized).toContain("Our plans start at $49/month.");
    expect(normalized).not.toMatch(/last updated/i);
    expect(normalized).not.toMatch(/©/);
    expect(normalized).not.toMatch(/views/);
  });

  it("is hash-stable: cosmetic variants normalize identically", () => {
    const variant = PAGE.replace("March 3, 2026", "March 4, 2026")
      .replace("1,234 views", "1,301 views")
      .replace("$49/month.", "$49/month.  ");
    expect(normalizeWebMarkdownForComparison(variant)).toBe(
      normalizeWebMarkdownForComparison(PAGE),
    );
  });
});

describe("classifyWebChange", () => {
  it("first sight is material", () => {
    expect(classifyWebChange(null, PAGE)).toBe("material");
  });

  it("identical raw text is unchanged", () => {
    expect(classifyWebChange(PAGE, PAGE)).toBe("unchanged");
  });

  it("date/counter churn is cosmetic", () => {
    const next = PAGE.replace("March 3, 2026", "July 12, 2026").replace(
      "1,234 views",
      "9,876 views",
    );
    expect(classifyWebChange(PAGE, next)).toBe("cosmetic");
  });

  it("substantive edits are material", () => {
    const next = PAGE.replace("$49/month", "$59/month");
    expect(classifyWebChange(PAGE, next)).toBe("material");
  });
});
