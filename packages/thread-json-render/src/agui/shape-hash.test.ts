import { describe, expect, it } from "vitest";
import { canonicalResultShape, resultShapeHash } from "./shape-hash.js";

describe("resultShapeHash", () => {
  it("is stable across value changes with identical structure", () => {
    const a = { rows: [{ name: "alpha", count: 1 }], total: 10 };
    const b = { rows: [{ name: "omega", count: 999 }], total: 42 };
    expect(resultShapeHash(a)).toBe(resultShapeHash(b));
  });

  it("is insensitive to key order", () => {
    const a = { total: 1, rows: [{ count: 2, name: "x" }] };
    const b = { rows: [{ name: "y", count: 3 }], total: 4 };
    expect(resultShapeHash(a)).toBe(resultShapeHash(b));
  });

  it("changes when a key is added", () => {
    const before = { rows: [{ name: "x" }] };
    const after = { rows: [{ name: "x", count: 1 }] };
    expect(resultShapeHash(before)).not.toBe(resultShapeHash(after));
  });

  it("changes when a key is removed", () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };
    expect(resultShapeHash(before)).not.toBe(resultShapeHash(after));
  });

  it("changes when a field's type flips", () => {
    const asNumber = { count: 1 };
    const asString = { count: "1" };
    expect(resultShapeHash(asNumber)).not.toBe(resultShapeHash(asString));
  });

  it("collapses homogeneous array element shape (count-insensitive)", () => {
    const one = { rows: [{ name: "a" }] };
    const many = { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] };
    expect(resultShapeHash(one)).toBe(resultShapeHash(many));
  });

  it("captures heterogeneous array element shapes as a union", () => {
    expect(canonicalResultShape([1, 2, 3])).toBe("[number]");
    expect(canonicalResultShape([1, "a"])).toBe("[number|string]");
    expect(canonicalResultShape(["a", 1])).toBe("[number|string]");
  });

  it("encodes primitives by type, not value", () => {
    expect(canonicalResultShape("hello")).toBe("string");
    expect(canonicalResultShape(7)).toBe("number");
    expect(canonicalResultShape(true)).toBe("boolean");
    expect(canonicalResultShape(null)).toBe("null");
    expect(canonicalResultShape(undefined)).toBe("null");
  });

  it("produces a namespaced, padded hash string", () => {
    expect(resultShapeHash({ a: 1 })).toMatch(/^shape-fnv1a:[0-9a-f]{8}$/);
  });
});
