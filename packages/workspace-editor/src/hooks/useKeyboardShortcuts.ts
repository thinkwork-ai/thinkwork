import { useEffect, type RefObject } from "react";

export interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  /**
   * When true, the shortcut is treated as cross-platform: Cmd on macOS
   * and Ctrl on Windows / Linux both satisfy it. Equivalent to dnd-kit /
   * react-hotkeys-hook's `mod` modifier. Set `meta` or `ctrl` to the
   * exact value if you need a platform-specific binding instead.
   */
  mod?: boolean;
  handler: () => void;
  description?: string;
}

export interface UseKeyboardShortcutsOptions {
  /**
   * When provided, shortcuts only fire while `document.activeElement` is
   * the scope element or one of its descendants. Lets a tree, modal, or
   * panel claim Cmd+X / Cmd+V / Backspace without globally hijacking
   * those keys.
   */
  scopeRef?: RefObject<HTMLElement | null>;
  /**
   * When true, the hook fires regardless of whether an editable element
   * is focused. Defaults to false — the historic behavior of ignoring
   * INPUT / TEXTAREA / SELECT / contenteditable targets.
   */
  enableInEditable?: boolean;
}

const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(e: Event): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (IGNORED_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

function isWithinScope(
  scope: HTMLElement | null | undefined,
  target: EventTarget | null,
): boolean {
  if (!scope) return false;
  if (!(target instanceof Node)) return false;
  return scope === target || scope.contains(target);
}

export function useKeyboardShortcuts(
  shortcuts: Shortcut[],
  options: UseKeyboardShortcutsOptions = {},
) {
  const { scopeRef, enableInEditable = false } = options;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!enableInEditable && isEditableTarget(e)) return;
      if (scopeRef) {
        const active = document.activeElement;
        if (!isWithinScope(scopeRef.current, active)) return;
      }

      for (const s of shortcuts) {
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();
        // `mod`: Cmd on Mac, Ctrl elsewhere — satisfied by either modifier.
        const modSatisfied = s.mod ? e.metaKey || e.ctrlKey : true;
        const metaMatch = s.mod ? true : s.meta ? e.metaKey : !e.metaKey;
        const ctrlMatch = s.mod ? true : s.ctrl ? e.ctrlKey : !e.ctrlKey;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (keyMatch && modSatisfied && metaMatch && ctrlMatch && shiftMatch) {
          e.preventDefault();
          s.handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, scopeRef, enableInEditable]);
}
