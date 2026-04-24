import { describe, expect, it } from "vitest";
import { computeMcpUrlHash, mcpHashMatches } from "../mcp-server-hash.js";

describe("computeMcpUrlHash", () => {
  it("produces a stable lowercase hex digest", () => {
    const h = computeMcpUrlHash("https://mcp.example/a", { token: "abc" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats equal payloads as equal regardless of key order", () => {
    const a = computeMcpUrlHash("https://x", { b: 2, a: 1 });
    const b = computeMcpUrlHash("https://x", { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("treats nested objects order-insensitively", () => {
    const a = computeMcpUrlHash("https://x", {
      outer: { b: 2, a: 1 },
      list: [{ y: 2, x: 1 }],
    });
    const b = computeMcpUrlHash("https://x", {
      list: [{ x: 1, y: 2 }],
      outer: { a: 1, b: 2 },
    });
    expect(a).toBe(b);
  });

  it("differs when url changes", () => {
    const a = computeMcpUrlHash("https://x", { t: 1 });
    const b = computeMcpUrlHash("https://y", { t: 1 });
    expect(a).not.toBe(b);
  });

  it("differs when any auth_config value changes", () => {
    const a = computeMcpUrlHash("https://x", { secretRef: "arn:a" });
    const b = computeMcpUrlHash("https://x", { secretRef: "arn:b" });
    expect(a).not.toBe(b);
  });

  it("treats undefined and null auth_config as equivalent", () => {
    const a = computeMcpUrlHash("https://x", null);
    const b = computeMcpUrlHash("https://x", undefined);
    expect(a).toBe(b);
  });

  it("distinguishes empty object from null auth_config", () => {
    const withObj = computeMcpUrlHash("https://x", {});
    const withNull = computeMcpUrlHash("https://x", null);
    expect(withObj).not.toBe(withNull);
  });
});

describe("mcpHashMatches", () => {
  it("returns true when the stored hash matches the current tuple", () => {
    const url = "https://mcp.example/a";
    const cfg = { secretRef: "arn:aws:secretsmanager:...", token: "tkn" };
    const h = computeMcpUrlHash(url, cfg);
    expect(mcpHashMatches(h, url, cfg)).toBe(true);
  });

  it("returns false when stored hash is null/empty", () => {
    expect(mcpHashMatches(null, "https://x", null)).toBe(false);
    expect(mcpHashMatches(undefined, "https://x", null)).toBe(false);
    expect(mcpHashMatches("", "https://x", null)).toBe(false);
  });

  it("returns false when any field drifts from the stored hash", () => {
    const h = computeMcpUrlHash("https://x", { t: "a" });
    expect(mcpHashMatches(h, "https://x", { t: "b" })).toBe(false);
    expect(mcpHashMatches(h, "https://y", { t: "a" })).toBe(false);
  });
});
