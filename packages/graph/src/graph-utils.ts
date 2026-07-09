/**
 * The renderer-agnostic graph logic (community detection, degree sizing, the
 * community color palette, node classification, neighborhood/focus math, layout
 * anchoring, and label wrapping/zoom-gating) now lives in
 * `@thinkwork/graph-core` so the mobile (Skia) renderer can share it with the
 * web (canvas) renderer — see THINK-235. This module re-exports that core and
 * keeps the single web-only helper: `isDarkMode`, which reads the DOM.
 */
export * from "@thinkwork/graph-core";

/** The web app toggles theme by stamping `dark` on the root element
 *  (see apps/web `applets/mount.tsx`) — the canvas painters read it per
 *  frame so graph chrome follows the theme. Web-only (reads the DOM); the
 *  native renderer passes its own `useColorScheme()` result instead. */
export function isDarkMode(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}
