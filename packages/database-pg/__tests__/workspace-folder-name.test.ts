import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceFolderName,
  workspaceFolderName,
} from "../src/utils/workspace-folder-name";

describe("workspaceFolderName", () => {
  it("derives legible folders from display names", () => {
    expect(workspaceFolderName("Eric Odom", [])).toBe("eric-odom");
  });

  it("adds a suffix only when a sibling collides", () => {
    expect(workspaceFolderName("Customer", ["customer"])).toBe("customer-2");
    expect(workspaceFolderName("Customer", ["customer", "customer-2"])).toBe(
      "customer-3",
    );
  });

  it("falls back for empty or symbol-only names", () => {
    expect(workspaceFolderName("!!!", [], "space")).toBe("space");
    expect(normalizeWorkspaceFolderName("", "thread")).toBe("thread");
  });
});
