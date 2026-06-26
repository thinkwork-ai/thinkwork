import { describe, expect, it } from "vitest";

import { createThreadJsonRenderSpecHash, stableStringify } from "./hash.js";

describe("thread json-render hashing", () => {
  it("produces stable hashes independent of object insertion order", () => {
    const first = {
      root: "root",
      elements: {
        root: {
          type: "Text",
          props: { variant: "body", text: "Ready" },
          children: [],
        },
      },
    };
    const second = {
      elements: {
        root: {
          children: [],
          props: { text: "Ready", variant: "body" },
          type: "Text",
        },
      },
      root: "root",
    };

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(createThreadJsonRenderSpecHash(first)).toBe(
      createThreadJsonRenderSpecHash(second),
    );
  });
});
