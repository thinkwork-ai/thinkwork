import { describe, expect, it } from "vitest";

import { stripNulDeep } from "./sanitize.js";

const NUL = "\u0000";

describe("stripNulDeep", () => {
  it("strips NUL from plain strings", () => {
    expect(stripNulDeep(`PK${NUL}garbage${NUL}`)).toBe("PKgarbage");
  });

  it("strips NUL recursively through objects and arrays", () => {
    const input = {
      response: `deck${NUL}summary`,
      tool_invocations: [
        { result: { content: [{ type: "text", text: `PK${NUL}${NUL}zip` }] } },
      ],
      count: 3,
      nothing: null,
    };
    expect(stripNulDeep(input)).toEqual({
      response: "decksummary",
      tool_invocations: [
        { result: { content: [{ type: "text", text: "PKzip" }] } },
      ],
      count: 3,
      nothing: null,
    });
  });

  it("passes through null, undefined, and numbers", () => {
    expect(stripNulDeep(null)).toBeNull();
    expect(stripNulDeep(undefined)).toBeUndefined();
    expect(stripNulDeep(42)).toBe(42);
  });
});
