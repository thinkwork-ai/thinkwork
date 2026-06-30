import { describe, expect, it } from "vitest";
import { isThreadGenUIActionKind, threadGenUIActionKinds } from "./actions.js";
import { THREAD_GENUI_ACTION_KINDS } from "./spec.js";

describe("threadGenUIActionKinds", () => {
  it("re-exports the spec-defined action kinds", () => {
    expect(threadGenUIActionKinds).toBe(THREAD_GENUI_ACTION_KINDS);
  });
});

describe("isThreadGenUIActionKind", () => {
  it.each(["approve", "reject", "submit", "open"])(
    "returns true for valid kind '%s'",
    (kind) => {
      expect(isThreadGenUIActionKind(kind)).toBe(true);
    },
  );

  it("returns false for unknown action kinds", () => {
    expect(isThreadGenUIActionKind("delete")).toBe(false);
    expect(isThreadGenUIActionKind("launch-missiles")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isThreadGenUIActionKind(42)).toBe(false);
    expect(isThreadGenUIActionKind(null)).toBe(false);
    expect(isThreadGenUIActionKind(undefined)).toBe(false);
    expect(isThreadGenUIActionKind(true)).toBe(false);
  });
});
