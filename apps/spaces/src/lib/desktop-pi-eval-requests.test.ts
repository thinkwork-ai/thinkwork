import { describe, expect, it, vi } from "vitest";
import {
  forgetDesktopPiEvalRequest,
  getDesktopPiEvalRequestId,
  rememberDesktopPiEvalRequest,
} from "./desktop-pi-eval-requests";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("Desktop Pi eval request storage", () => {
  it("remembers, reads, and forgets a local request id by run id", () => {
    const storage = memoryStorage();

    rememberDesktopPiEvalRequest("run-1", "request-1", storage);

    expect(getDesktopPiEvalRequestId("run-1", storage)).toBe("request-1");

    forgetDesktopPiEvalRequest("run-1", storage);

    expect(getDesktopPiEvalRequestId("run-1", storage)).toBeNull();
  });

  it("ignores corrupt storage payloads", () => {
    const storage = memoryStorage();
    storage.setItem("thinkwork:desktop-pi-eval-requests:v1", "{{bad json");

    expect(getDesktopPiEvalRequestId("run-1", storage)).toBeNull();
  });
});
