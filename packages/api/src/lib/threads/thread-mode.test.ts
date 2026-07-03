import { describe, expect, it } from "vitest";
import { deriveThreadMode } from "./thread-mode.js";

describe("deriveThreadMode", () => {
  it("is agent with a single human participant", () => {
    expect(deriveThreadMode(1, null)).toBe("agent");
  });

  it("is agent with zero human participants (agent/system-created thread)", () => {
    expect(deriveThreadMode(0, null)).toBe("agent");
  });

  it("is multiplayer with two human participants", () => {
    expect(deriveThreadMode(2, null)).toBe("multiplayer");
  });

  it("is multiplayer with more than two human participants", () => {
    expect(deriveThreadMode(5, null)).toBe("multiplayer");
  });

  it("override to agent wins over a 2+ human count", () => {
    expect(deriveThreadMode(3, "agent")).toBe("agent");
  });

  it("override to multiplayer wins over a 0–1 human count", () => {
    expect(deriveThreadMode(1, "multiplayer")).toBe("multiplayer");
    expect(deriveThreadMode(0, "multiplayer")).toBe("multiplayer");
  });

  it("treats an undefined override the same as null (derives from count)", () => {
    expect(deriveThreadMode(1, undefined)).toBe("agent");
    expect(deriveThreadMode(2, undefined)).toBe("multiplayer");
  });
});
