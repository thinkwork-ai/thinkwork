/**
 * Pure-logic tests for the E2E assertion pattern-matcher. Runs under
 * the default vitest config (not the sandbox:e2e config) because it
 * doesn't touch live infra.
 *
 * Note: this file lives next to the _harness sources so TypeScript
 * resolves the relative import cleanly. The default vitest config
 * excludes test/integration/sandbox/, but a .test.ts inside _harness
 * still runs — we want that. Move to src/ if that ever changes.
 */
import { describe, it, expect } from "vitest";
import { _testOnly, findTokenMatches } from "./assertions.js";

describe("findTokenMatches", () => {
  it("matches Authorization Bearer header", () => {
    const hits = findTokenMatches(["Authorization: Bearer abc.def.ghi_jkl"]);
    expect(hits.map((h) => h.pattern)).toContain(
      "Authorization Bearer header",
    );
  });

  it("matches a github prefix", () => {
    const hits = findTokenMatches([
      "agent said: ghp_abcDEF12345678901234567890 next line",
    ]);
    expect(hits.map((h) => h.pattern)).toContain(
      "known OAuth prefix (ghp_/xoxb-/ya29.)",
    );
  });

  it("matches a slack bot token", () => {
    const hits = findTokenMatches(["xoxb-123456789-abcdef"]);
    expect(hits.some((h) => h.sample.startsWith("xoxb-"))).toBe(true);
  });

  it("matches a JWT triple", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const hits = findTokenMatches([`header X-Auth=${jwt}`]);
    expect(hits.some((h) => h.pattern === "JWT triple")).toBe(true);
  });

  it("ignores a bare word 'Bearer' that isn't a header", () => {
    const hits = findTokenMatches(["the bearer of bad news is here"]);
    expect(hits).toHaveLength(0);
  });

  it("ignores short three-dotted strings (not JWTs)", () => {
    const hits = findTokenMatches(["version a.b.c is out"]);
    expect(hits).toHaveLength(0);
  });

  it("finds the synthetic token value when forbiddenValues names it", () => {
    const hits = findTokenMatches(
      ["harmless log line that mentions synth-12345 in passing"],
      ["synth-12345"],
    );
    expect(hits.some((h) => h.pattern === "forbidden-value")).toBe(true);
  });

  it("returns empty array for clean logs", () => {
    const hits = findTokenMatches([
      "[INFO] sandbox session started",
      "[INFO] processed 42 rows in 17ms",
    ]);
    expect(hits).toHaveLength(0);
  });

  it("exposes the full pattern set for regression awareness", () => {
    // If someone extends assertions.PATTERNS but forgets to wire the
    // new pattern into the Unit 12 scrubber (or vice-versa), the count
    // mismatch is a loud signal — harness checks fewer shapes than the
    // backstop redacts, or redacts fewer than it checks.
    expect(_testOnly.PATTERNS.length).toBe(3);
  });
});
