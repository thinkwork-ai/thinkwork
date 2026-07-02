/**
 * Managed-section awareness for the shared WorkspaceFileEditor (Composer
 * plan 2026-07-02-001 U7; R9, F3, KTD-1).
 *
 * Some governance files (AGENTS.md, CONTEXT.md) carry *managed sections*:
 * known `## ` headings whose bodies are recomputed from the effective
 * capability set on every render and on every skill toggle. An operator who
 * edits inside one of those bodies has their edit silently destroyed on the
 * next recomposition. This module lets the editor mark those bodies as
 * computed and warn before a save lands inside one.
 *
 * The affordance lives in the shared editor precisely because the split-view
 * Composer is NOT the only writer: Settings → Workspace and the scoped
 * space/user editors write the same source files, and the map path
 * (`packages/api/src/lib/workspace-map-generator.ts`) recomposes these
 * sections back into the source AGENTS.md on skill toggles. An unmarked
 * editor lets any of those surfaces save a doomed edit.
 *
 * IMPORTANT — cross-package coupling (no import allowed):
 * The managed-heading vocabulary below MUST stay in sync with the authoritative
 * definition in `packages/api/src/lib/workspace-renderer/managed-sections.ts`
 * (`AGENTS_MD_MANAGED_SECTION_ORDER` = "Folder Structure", "Skills & Tools";
 * `CONTEXT_MD_MANAGED_SECTION_ORDER` = "Routing"). workspace-editor is a
 * leaf UI package and cannot import from `packages/api`, so the constant is
 * duplicated here on purpose. If the API vocabulary changes, update this list.
 */

/**
 * Default managed-heading vocabulary — the union of every managed heading the
 * API composer recomputes. Embedding surfaces inherit this with zero wiring;
 * a host may override via the `managedSectionHeadings` prop.
 */
export const DEFAULT_MANAGED_SECTION_HEADINGS: readonly string[] = [
  "Folder Structure",
  "Skills & Tools",
  "Routing",
];

export interface ManagedSectionRange {
  heading: string;
  /** Char offset of the start of the `## <heading>` line. */
  headingStart: number;
  /** Char offset of the first character of the section body. */
  bodyStart: number;
  /** Char offset one past the last character of the section body. */
  bodyEnd: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate every managed `## <heading>` section body in `markdown`. A section
 * body runs from the end of its heading line to the next `## ` heading or
 * `---` divider (or end of document). Mirrors the range-finding contract in
 * `packages/api/.../managed-sections.ts` so the editor's notion of "inside a
 * managed section" matches what the composer will overwrite.
 */
export function findManagedSectionRanges(
  markdown: string,
  headings: readonly string[],
): ManagedSectionRange[] {
  const ranges: ManagedSectionRange[] = [];
  for (const heading of headings) {
    const headingPattern = new RegExp(
      `(^|\\n)## ${escapeRegExp(heading)}[ \\t]*(?:\\r?\\n|$)`,
      "g",
    );
    const match = headingPattern.exec(markdown);
    if (!match) continue;

    const headingStart = match.index + (match[1] === "\n" ? 1 : 0);
    const bodyStart = headingPattern.lastIndex;
    const linePattern = /[^\n]*(?:\n|$)/g;
    linePattern.lastIndex = bodyStart;

    let bodyEnd = markdown.length;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = linePattern.exec(markdown))) {
      const lineStart = lineMatch.index;
      if (lineStart >= markdown.length) break;
      const line = lineMatch[0];
      const trimmed = line.trim();
      if (
        lineStart > headingStart &&
        (trimmed === "---" || line.startsWith("## "))
      ) {
        bodyEnd = lineStart;
        break;
      }
      if (linePattern.lastIndex >= markdown.length) break;
    }

    ranges.push({ heading, headingStart, bodyStart, bodyEnd });
  }
  return ranges.sort((a, b) => a.headingStart - b.headingStart);
}

/** True when `markdown` contains at least one managed section body. */
export function hasManagedSections(
  markdown: string,
  headings: readonly string[],
): boolean {
  return findManagedSectionRanges(markdown, headings).length > 0;
}

/** The managed heading names present in `markdown`, in document order. */
export function managedSectionHeadingsPresent(
  markdown: string,
  headings: readonly string[],
): string[] {
  return findManagedSectionRanges(markdown, headings).map(
    (range) => range.heading,
  );
}

/**
 * The `[start, end)` span in `a` that differs from `b`, computed by stripping
 * the common prefix and suffix. Returns `null` when the strings are equal.
 * `endA`/`endB` are the exclusive ends in each string's own coordinates.
 */
function changedSpan(
  a: string,
  b: string,
): { start: number; endA: number; endB: number } | null {
  if (a === b) return null;
  const maxPrefix = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length) - prefix;
  while (
    suffix < maxSuffix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    start: prefix,
    endA: a.length - suffix,
    endB: b.length - suffix,
  };
}

function spanOverlapsAnyBody(
  ranges: ManagedSectionRange[],
  start: number,
  end: number,
): boolean {
  // A zero-length change (pure insertion) at offset `start` counts as inside a
  // body when `start` falls within `[bodyStart, bodyEnd]` inclusive so that
  // typing at either edge of a computed body is caught.
  return ranges.some(
    (range) => start <= range.bodyEnd && end >= range.bodyStart,
  );
}

/**
 * True when the diff between `previous` and `next` touches any managed section
 * body. Checked in BOTH coordinate systems so deletions (shrinking a body in
 * `previous`) and insertions (growing a body in `next`) are both caught.
 */
export function editTouchesManagedSection(
  previous: string,
  next: string,
  headings: readonly string[],
): boolean {
  const span = changedSpan(previous, next);
  if (!span) return false;

  const previousRanges = findManagedSectionRanges(previous, headings);
  if (spanOverlapsAnyBody(previousRanges, span.start, span.endA)) return true;

  const nextRanges = findManagedSectionRanges(next, headings);
  return spanOverlapsAnyBody(nextRanges, span.start, span.endB);
}
