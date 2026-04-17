import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { notYetImplemented } from "../src/lib/stub.js";

let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notYetImplemented", () => {
  it("writes a framed message to stderr including command path and phase", () => {
    notYetImplemented("thread list", 1);
    const combined = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(combined).toContain("thinkwork thread list");
    expect(combined).toContain("Phase 1");
    expect(combined).toContain("not yet implemented");
  });

  it("includes the README roadmap link", () => {
    notYetImplemented("agent create", 2);
    const combined = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(combined).toContain("apps/cli/README.md#roadmap");
  });

  it("exits with code 2 so CI scripts can distinguish it from regular errors", () => {
    notYetImplemented("cost summary", 5);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("writes nothing to stdout (stays out of --json stdout)", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    notYetImplemented("budget upsert", 5);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
