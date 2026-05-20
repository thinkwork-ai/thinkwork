import { describe, expect, it } from "vitest";
import { isChatSidebarPath } from "./ComputerSidebar";

describe("isChatSidebarPath", () => {
  it("keeps artifact detail routes in the chat sidebar context", () => {
    expect(isChatSidebarPath("/artifacts/artifact-1")).toBe(true);
    expect(isChatSidebarPath("/artifacts")).toBe(false);
  });
});
