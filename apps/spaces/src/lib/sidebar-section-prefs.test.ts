import { describe, it, expect, beforeEach } from "vitest";
import {
  getSectionUnreadFilter,
  setSectionUnreadFilter,
} from "./sidebar-section-prefs";

// The test environment's built-in localStorage is incomplete, so install a
// self-contained Map-backed stub (mirrors thread-notifications-pref.test.ts).
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

const KEY = "thinkwork:sidebar-section-unread-filter";

describe("sidebar-section-prefs", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("defaults to off (Show all) for an unknown section", () => {
    expect(getSectionUnreadFilter("chats")).toBe(false);
    expect(getSectionUnreadFilter("space:abc")).toBe(false);
  });

  it("round-trips on/off for a section and survives across reads (= reloads)", () => {
    setSectionUnreadFilter("chats", true);
    expect(getSectionUnreadFilter("chats")).toBe(true);
    setSectionUnreadFilter("chats", false);
    expect(getSectionUnreadFilter("chats")).toBe(false);
  });

  it("keeps two section ids independent", () => {
    setSectionUnreadFilter("chats", true);
    expect(getSectionUnreadFilter("chats")).toBe(true);
    expect(getSectionUnreadFilter("space:abc")).toBe(false);

    setSectionUnreadFilter("space:abc", true);
    setSectionUnreadFilter("chats", false);
    expect(getSectionUnreadFilter("space:abc")).toBe(true);
    expect(getSectionUnreadFilter("chats")).toBe(false);
  });

  it("prunes the key when turned off rather than storing false", () => {
    setSectionUnreadFilter("chats", true);
    setSectionUnreadFilter("chats", false);
    expect(window.localStorage.getItem(KEY)).toBe("{}");
  });

  it("falls back to all-off when stored JSON is garbage", () => {
    window.localStorage.setItem(KEY, "not json {{{");
    expect(getSectionUnreadFilter("chats")).toBe(false);
    // A subsequent write recovers cleanly.
    setSectionUnreadFilter("chats", true);
    expect(getSectionUnreadFilter("chats")).toBe(true);
  });

  it("ignores a non-object stored value (e.g. a JSON array)", () => {
    window.localStorage.setItem(KEY, "[1,2,3]");
    expect(getSectionUnreadFilter("chats")).toBe(false);
  });
});
