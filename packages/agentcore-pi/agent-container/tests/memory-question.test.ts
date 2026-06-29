import { describe, expect, it } from "vitest";

import {
  directMemoryGroundingQuery,
  explicitMemoryTurn,
} from "../src/runtime/memory-question.js";

describe("directMemoryGroundingQuery", () => {
  it("detects direct personal memory questions", () => {
    expect(directMemoryGroundingQuery("what's my dog's name?")).toBe(
      "what's my dog's name?",
    );
    expect(
      directMemoryGroundingQuery("Do you remember my favorite color?"),
    ).toBe("Do you remember my favorite color?");
    expect(
      directMemoryGroundingQuery(
        "What do you remember about my calibration shelf marker?",
      ),
    ).toBe("What do you remember about my calibration shelf marker?");
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

describe("explicitMemoryTurn", () => {
  it("detects direct memory recall questions", () => {
    expect(explicitMemoryTurn("What do you remember about my dog?")).toBe(true);
  });

  it("detects direct memory retention commands", () => {
    expect(
      explicitMemoryTurn(
        "Please remember this user memory for a future separate thread: my user orbit checksum is UserMarker248bbf87.",
      ),
    ).toBe(true);
    expect(
      explicitMemoryTurn(
        "Please remember this Space memory for a future separate thread: the shared space orbit checksum is SpaceMarker248bbf87.",
      ),
    ).toBe(true);
    expect(
      explicitMemoryTurn(
        "Save this long-term memory for later: Birdie likes blue toys.",
      ),
    ).toBe(true);
  });

  it("does not classify ordinary work prompts as explicit memory turns", () => {
    expect(explicitMemoryTurn("Write a release note.")).toBe(false);
    expect(explicitMemoryTurn("Store the build artifact in S3.")).toBe(false);
  });

  it("ignores non-string or overlarge inputs", () => {
    expect(explicitMemoryTurn(null)).toBe(false);
    expect(explicitMemoryTurn("Please remember this for later. ".repeat(40))).toBe(
      false,
    );
  });
});
