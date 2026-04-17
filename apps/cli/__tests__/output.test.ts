import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setJsonMode,
  isJsonMode,
  printJson,
  printKeyValue,
  printTable,
  logStderr,
} from "../src/lib/output.js";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  setJsonMode(false);
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  logSpy.mockRestore();
});

describe("output / --json mode", () => {
  it("starts with human mode and switches when setJsonMode(true)", () => {
    expect(isJsonMode()).toBe(false);
    setJsonMode(true);
    expect(isJsonMode()).toBe(true);
  });

  it("printJson is a no-op in human mode", () => {
    setJsonMode(false);
    printJson({ a: 1 });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("printJson writes a single JSON document to stdout in JSON mode", () => {
    setJsonMode(true);
    printJson({ tenant: "acme" });
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const written = String(stdoutSpy.mock.calls[0][0]);
    expect(JSON.parse(written)).toEqual({ tenant: "acme" });
  });

  it("printKeyValue is suppressed in JSON mode", () => {
    setJsonMode(true);
    printKeyValue([["Stage", "dev"]]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("printTable prints (no results) for an empty table", () => {
    setJsonMode(false);
    printTable([], [{ key: "id", header: "ID" }]);
    expect(logSpy).toHaveBeenCalled();
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain("no results");
  });

  it("logStderr always goes to stderr (independent of mode)", () => {
    setJsonMode(true);
    logStderr("heads up");
    expect(stderrSpy).toHaveBeenCalled();
    const written = String(stderrSpy.mock.calls[0][0]);
    expect(written).toContain("heads up");
  });
});
