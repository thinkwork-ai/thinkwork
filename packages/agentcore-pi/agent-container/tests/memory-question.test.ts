import { describe, expect, it } from "vitest";

import { directMemoryGroundingQuery } from "../src/runtime/memory-question.js";

describe("directMemoryGroundingQuery", () => {
  it("detects direct personal memory questions", () => {
    expect(directMemoryGroundingQuery("what's my dog's name?")).toBe(
      "what's my dog's name?",
    );
    expect(
      directMemoryGroundingQuery("Do you remember my favorite color?"),
    ).toBe("Do you remember my favorite color?");
  });

  it("detects direct Space memory questions", () => {
    expect(
      directMemoryGroundingQuery("What is this space's launch codename again?"),
    ).toBe("What is this space's launch codename again?");
  });

  it("does not ground ordinary non-memory prompts", () => {
    expect(directMemoryGroundingQuery("Write a release note.")).toBeUndefined();
    expect(
      directMemoryGroundingQuery("What is the weather today?"),
    ).toBeUndefined();
  });

  it("ignores non-string or overlarge inputs", () => {
    expect(directMemoryGroundingQuery(null)).toBeUndefined();
    expect(
      directMemoryGroundingQuery("what's my dog's name? ".repeat(40)),
    ).toBeUndefined();
  });
});
