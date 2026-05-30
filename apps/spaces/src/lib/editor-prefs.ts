import { useSyncExternalStore } from "react";

/**
 * Client-side editor preferences for the Workspace file viewer, persisted in
 * localStorage so they survive reloads. Mirrors the thread-notifications-pref
 * pattern (useSyncExternalStore + same-tab event + cross-tab storage event).
 *
 * - Wrap text: default OFF (long lines scroll horizontally).
 * - Font size (px): default 14 (matches the editor's prior text-sm), clamped to
 *   a sane range so a stale/garbage value can't render an unusable editor.
 */
const WRAP_KEY = "thinkwork:editor-wrap";
const FONT_SIZE_KEY = "thinkwork:editor-font-size";
const EVENT = "thinkwork:editor-prefs";

export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 20;
/** Selectable font sizes surfaced in the settings control. */
export const EDITOR_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20] as const;

function readWrap(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WRAP_KEY) === "true";
}

function readFontSize(): number {
  if (typeof window === "undefined") return DEFAULT_EDITOR_FONT_SIZE;
  const raw = Number(window.localStorage.getItem(FONT_SIZE_KEY));
  if (
    !Number.isFinite(raw) ||
    raw < MIN_EDITOR_FONT_SIZE ||
    raw > MAX_EDITOR_FONT_SIZE
  ) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return raw;
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
  // Same-tab subscribers (the storage event only fires cross-tab).
  window.dispatchEvent(new Event(EVENT));
}

export function getEditorWrap(): boolean {
  return readWrap();
}

export function setEditorWrap(enabled: boolean): void {
  write(WRAP_KEY, enabled ? "true" : "false");
}

export function getEditorFontSize(): number {
  return readFontSize();
}

export function setEditorFontSize(px: number): void {
  const clamped = Math.min(
    MAX_EDITOR_FONT_SIZE,
    Math.max(MIN_EDITOR_FONT_SIZE, Math.round(px)),
  );
  write(FONT_SIZE_KEY, String(clamped));
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === WRAP_KEY ||
      event.key === FONT_SIZE_KEY
    ) {
      callback();
    }
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** React binding for the wrap preference. */
export function useEditorWrap(): boolean {
  return useSyncExternalStore(subscribe, readWrap, () => false);
}

/** React binding for the editor font size (px). */
export function useEditorFontSize(): number {
  return useSyncExternalStore(
    subscribe,
    readFontSize,
    () => DEFAULT_EDITOR_FONT_SIZE,
  );
}
