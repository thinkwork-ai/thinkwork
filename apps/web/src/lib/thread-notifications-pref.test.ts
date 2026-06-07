import { describe, it, expect, beforeEach } from "vitest";
import {
  getThreadNotificationsEnabled,
  setThreadNotificationsEnabled,
} from "./thread-notifications-pref";

// The test environment's built-in localStorage is incomplete (no
// removeItem/clear), so install a self-contained Map-backed stub.
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
}

describe("thread-notifications-pref", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("defaults to enabled when nothing is stored (R10)", () => {
    expect(getThreadNotificationsEnabled()).toBe(true);
  });

  it("persists a disabled preference", () => {
    setThreadNotificationsEnabled(false);
    expect(getThreadNotificationsEnabled()).toBe(false);
    expect(window.localStorage.getItem("thinkwork:thread-notifications-enabled")).toBe(
      "false",
    );
  });

  it("re-enables after being disabled (survives across reads = across reloads)", () => {
    setThreadNotificationsEnabled(false);
    setThreadNotificationsEnabled(true);
    expect(getThreadNotificationsEnabled()).toBe(true);
  });
});
