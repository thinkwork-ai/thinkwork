import { describe, it, expect } from "vitest";
import { slugify } from "../slugify.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes non-alphanumeric characters", () => {
    expect(slugify("foo@bar!baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("caps at maxLength", () => {
    const long = "a".repeat(100);
    expect(slugify(long, 80).length).toBe(80);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});
