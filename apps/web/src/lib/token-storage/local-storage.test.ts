import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageTokenStorage } from "./local-storage";

const ORIGINAL_LOCAL_STORAGE = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  if (ORIGINAL_LOCAL_STORAGE) {
    Object.defineProperty(window, "localStorage", ORIGINAL_LOCAL_STORAGE);
  }
});

describe("LocalStorageTokenStorage", () => {
  it("writes and reads through localStorage", () => {
    const storage = new LocalStorageTokenStorage();

    storage.setItem("x", "y");

    expect(window.localStorage.getItem("x")).toBe("y");
    expect(storage.getItem("x")).toBe("y");
  });

  it("removes missing keys as a no-op", () => {
    const storage = new LocalStorageTokenStorage();

    expect(() => storage.removeItem("missing")).not.toThrow();
    expect(storage.getItem("missing")).toBeNull();
  });

  it("notifies subscribers when a cross-tab storage event fires", () => {
    const storage = new LocalStorageTokenStorage();
    const listener = vi.fn();
    const unsubscribe = storage.subscribe(listener);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "x",
        oldValue: null,
        newValue: "y",
      }),
    );

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: "x" }));

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}
