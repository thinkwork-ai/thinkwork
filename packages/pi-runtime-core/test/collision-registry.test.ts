import { describe, expect, it } from "vitest";
import {
  bindingToolName,
  resolveAgainstReserved,
  resolveToolNameClaims,
  CAPABILITY_TOOL_SOURCES,
  type CapabilityToolSource,
  type ToolNameClaim,
} from "../src/collision-registry.js";
import { BUILTIN_TOOL_NAMES } from "../src/agent-loop.js";

const claim = (
  name: string,
  source: CapabilityToolSource,
  origin?: string,
): ToolNameClaim => ({ name, source, ...(origin ? { origin } : {}) });

describe("resolveToolNameClaims", () => {
  it("enforces precedence across every source pair", () => {
    for (let hi = 0; hi < CAPABILITY_TOOL_SOURCES.length; hi++) {
      for (let lo = hi + 1; lo < CAPABILITY_TOOL_SOURCES.length; lo++) {
        const strong = CAPABILITY_TOOL_SOURCES[hi]!;
        const weak = CAPABILITY_TOOL_SOURCES[lo]!;
        // Weak claim listed FIRST — precedence must beat claim order.
        const verdicts = resolveToolNameClaims([
          claim("shared_name", weak, "weak-origin"),
          claim("shared_name", strong, "strong-origin"),
        ]);
        expect(verdicts[0]).toMatchObject({
          ok: false,
          reason: "collision",
          winner: { source: strong },
        });
        expect(verdicts[1]).toMatchObject({ ok: true });
      }
    }
  });

  it("fails the second duplicate within the same source", () => {
    const verdicts = resolveToolNameClaims([
      claim("scrape", "binding", "firecrawl"),
      claim("scrape", "binding", "other-conn"),
    ]);
    expect(verdicts[0]).toMatchObject({ ok: true });
    expect(verdicts[1]).toMatchObject({
      ok: false,
      reason: "collision",
      winner: { source: "binding", origin: "firecrawl" },
    });
  });

  it("is case-sensitive, matching the runtime's exact-match Set", () => {
    const verdicts = resolveToolNameClaims([
      claim("Scrape", "binding"),
      claim("scrape", "script"),
    ]);
    expect(verdicts.every((v) => v.ok)).toBe(true);
  });

  it("rejects malformed names with the runtime's TOOL_NAME_RE", () => {
    const verdicts = resolveToolNameClaims([
      claim("1starts-with-digit", "binding"),
      claim("has space", "binding"),
      claim("x".repeat(65), "binding"),
      claim("fine_name-2", "binding"),
    ]);
    expect(verdicts[0]).toMatchObject({ ok: false, reason: "malformed_name" });
    expect(verdicts[1]).toMatchObject({ ok: false, reason: "malformed_name" });
    expect(verdicts[2]).toMatchObject({ ok: false, reason: "malformed_name" });
    expect(verdicts[3]).toMatchObject({ ok: true });
  });
});

describe("resolveAgainstReserved", () => {
  it("builtin always wins over a colliding candidate (AE2)", () => {
    const verdicts = resolveAgainstReserved(
      { builtinNames: BUILTIN_TOOL_NAMES, platformNames: ["web_search"] },
      [
        claim("bash", "script", "sneaky"),
        claim("web_search", "binding", "web"),
      ],
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({
      ok: false,
      reason: "collision",
      winner: { source: "builtin" },
    });
    expect(verdicts[1]).toMatchObject({
      ok: false,
      reason: "collision",
      winner: { source: "platform" },
    });
  });

  it("passes non-colliding candidates through", () => {
    const verdicts = resolveAgainstReserved(
      { builtinNames: BUILTIN_TOOL_NAMES },
      [claim("firecrawl_scrape", "binding", "firecrawl")],
    );
    expect(verdicts[0]).toMatchObject({ ok: true });
  });
});

describe("bindingToolName (R19)", () => {
  it("namespaces as <connection>_<operation>", () => {
    expect(bindingToolName("firecrawl", "scrape")).toBe("firecrawl_scrape");
  });

  it("a namespaced name can still collide with a builtin — registry catches it", () => {
    const name = bindingToolName("web", "search");
    expect(name).toBe("web_search");
    const verdicts = resolveAgainstReserved(
      { builtinNames: BUILTIN_TOOL_NAMES, platformNames: ["web_search"] },
      [claim(name, "binding", "web")],
    );
    expect(verdicts[0]).toMatchObject({ ok: false, reason: "collision" });
  });

  it("sanitizes to the runtime alphabet and caps at 64", () => {
    const name = bindingToolName("weird.conn", "op with spaces!");
    expect(name).toBe("weird_conn_op_with_spaces_");
    expect(bindingToolName("c".repeat(80), "op")).toHaveLength(64);
    expect(bindingToolName("9numeric", "op").startsWith("numeric")).toBe(true);
  });
});
