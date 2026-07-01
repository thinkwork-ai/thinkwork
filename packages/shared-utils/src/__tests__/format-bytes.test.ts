import { describe, it, expect } from "vitest";
import { formatBytes } from "../format-bytes.js";

describe("formatBytes", () => {
  it("returns '0 B' for zero, null, or undefined", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(15_728_640)).toBe("15 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });

  it("returns '0 B' for negative values", () => {
    expect(formatBytes(-100)).toBe("0 B");
  });
});
