import { describe, expect, it } from "vitest";

import { createThreadGenUISpecHash, stableStringify } from "./hash.js";

describe("createThreadGenUISpecHash", () => {
  it("is stable across object key order", () => {
    const first = { b: 2, a: { z: true, y: "x" } };
    const second = { a: { y: "x", z: true }, b: 2 };

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(createThreadGenUISpecHash(first)).toBe(
      createThreadGenUISpecHash(second),
    );
  });

  it("changes when the visible spec revision changes", () => {
    expect(createThreadGenUISpecHash({ title: "A" })).not.toBe(
      createThreadGenUISpecHash({ title: "B" }),
    );
  });
});
