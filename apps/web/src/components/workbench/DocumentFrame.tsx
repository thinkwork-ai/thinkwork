/**
 * HTML Document Artifacts (THINK-147 U6): the scriptless document reader
 * frame.
 *
 * Documents render agent-authored, DocSpector-validated single-file HTML in
 * the tightest possible containment: a srcDoc iframe with `sandbox=""` — zero
 * grants, opaque origin, no scripts, no postMessage bridge (deliberately NOT
 * McpAppFrame, whose `allow-scripts` + channelId machinery documents never
 * need).
 *
 * Two things are prepended into the srcDoc before mounting (KTD6):
 *  1. a restrictive CSP meta tag, so the frame's runtime boundary matches the
 *     validated contract even though srcDoc frames inherit the parent CSP —
 *     defense in depth over DocSpector's default-deny;
 *  2. an app-theme token (`color-scheme` + `data-theme` attribute + a `.dark`
 *     class on <html>), because `prefers-color-scheme` inheritance into
 *     opaque-origin frames is browser-dependent and tracks the OS, not the
 *     app toggle. Plates key their dark styles off `prefers-color-scheme`
 *     with `:root[data-theme="dark"]` overrides, so the injected token wins
 *     in both directions.
 */

import { useMemo } from "react";
import { useTheme } from "@thinkwork/ui";

export const DOCUMENT_FRAME_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;";

export interface DocumentFrameProps {
  html: string;
  title: string;
  /** Fill the parent (reader route) instead of a bounded card height. */
  fullHeight?: boolean;
}

/** Resolve the app theme to the binary token documents style against. */
export function documentThemeToken(
  theme: string | undefined,
): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  // "system" (or unknown): follow the OS preference like the app shell does.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Prepend the CSP meta + theme token into the document HTML. Exported for
 * tests: the theme injection is what AE4's app-theme-opposite-OS case rides on.
 */
export function withDocumentFrameEnvelope(
  html: string,
  theme: "light" | "dark",
): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_FRAME_CSP}">`;
  const themeStyle = `<style data-thinkwork-document-theme>:root{color-scheme:${theme};}</style>`;
  const themeScriptless = `${cspMeta}${themeStyle}`;

  // Stamp data-theme on <html> so plate CSS `:root[data-theme="dark"]`
  // overrides fire without scripts.
  let out = html;
  const htmlTag = out.match(/<html(\s[^>]*)?>/i);
  if (htmlTag?.index != null) {
    const attrs = htmlTag[1] ?? "";
    const replaced = `<html${attrs} data-theme="${theme}">`;
    out =
      out.slice(0, htmlTag.index) +
      replaced +
      out.slice(htmlTag.index + htmlTag[0].length);
  }

  const headMatch = out.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch?.index == null) return `${themeScriptless}${out}`;
  const insertAt = headMatch.index + headMatch[0].length;
  return `${out.slice(0, insertAt)}${themeScriptless}${out.slice(insertAt)}`;
}

export function DocumentFrame({ html, title, fullHeight }: DocumentFrameProps) {
  const { theme } = useTheme();
  const token = documentThemeToken(theme);
  const srcDoc = useMemo(
    () => withDocumentFrameEnvelope(html, token),
    [html, token],
  );

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      // Zero grants: no scripts, no forms, no popups, no same-origin. The
      // document tier is scriptless by contract (AE5's render half).
      sandbox=""
      data-testid="document-frame"
      className={
        fullHeight
          ? "block h-full w-full flex-1 border-0 bg-background"
          : "block h-[560px] w-full rounded-lg border border-border bg-background"
      }
    />
  );
}
