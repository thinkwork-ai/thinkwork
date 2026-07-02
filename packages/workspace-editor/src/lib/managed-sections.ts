/**
 * Managed-section awareness for workspace source editors (Composer plan U7).
 *
 * Since U4/U5, AGENTS.md and CONTEXT.md carry managed sections whose bodies
 * are recomputed from the effective capability set on every recomposition
 * (`packages/api/src/lib/workspace-renderer/managed-sections.ts`). An edit an
 * operator makes inside one of those bodies is silently destroyed the next
 * time sections recompute, so every surface that edits these source files —
 * the Composer split view, Settings → Workspace, the scoped space/user
 * editors — must render the bodies as computed and warn before saving an
 * edit that falls inside one. That is why this lives in the shared editor
 * package rather than any single host.
 *
 * The heading vocabulary and range semantics MIRROR the API module (a
 * section is a `## <name>` heading; its body ends at the next `## ` heading
 * or `---` divider line, or EOF). The API module cannot be imported here —
 * it sits behind the server-only render path — so the vocabulary is pinned
 * by tests on both sides.
 */

export const MANAGED_HEADINGS_BY_BASENAME: Readonly<
  Record<string, readonly string[]>
> = {
  "AGENTS.md": ["Folder Structure", "Skills & Tools"],
  "CONTEXT.md": ["Routing"],
};

/** Managed headings for a workspace file path (empty = nothing managed). */
export function managedHeadingsForFile(path: string): readonly string[] {
  const basename = path.split("/").pop() ?? path;
  return MANAGED_HEADINGS_BY_BASENAME[basename] ?? [];
}

export interface ManagedSectionRange {
  heading: string;
  /** Offset of the `## ` heading line start. */
  headingStart: number;
  /** Offset just past the heading line — where the computed body begins. */
  bodyStart: number;
  /** Offset of the first line NOT in the section (exclusive). */
  end: number;
}

function findSectionRange(
  markdown: string,
  sectionName: string,
): ManagedSectionRange | null {
  const headingPattern = new RegExp(
    `(^|\\n)## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?:\\r?\\n|$)`,
    "g",
  );
  const match = headingPattern.exec(markdown);
  if (!match) return null;

  const headingStart = match.index + (match[1] === "\n" ? 1 : 0);
  const bodyStart = headingPattern.lastIndex;
  const linePattern = /[^\n]*(?:\n|$)/g;
  linePattern.lastIndex = bodyStart;

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
      return { heading: sectionName, headingStart, bodyStart, end: lineStart };
    }
    if (linePattern.lastIndex >= markdown.length) break;
  }

  return { heading: sectionName, headingStart, bodyStart, end: markdown.length };
}

/** All managed-section ranges present in a file, in document order. */
export function findManagedSectionRanges(
  path: string,
  content: string,
): ManagedSectionRange[] {
  const ranges: ManagedSectionRange[] = [];
  for (const heading of managedHeadingsForFile(path)) {
    const range = findSectionRange(content, heading);
    if (range) ranges.push(range);
  }
  return ranges.sort((a, b) => a.headingStart - b.headingStart);
}

/**
 * Headings whose computed bodies differ between the loaded content and the
 * edited value — the warn-on-save trigger. A heading that was present and
 * is now gone counts as edited (deleting a computed section is still an
 * edit that recomposition will undo).
 */
export function managedSectionsEdited(
  path: string,
  original: string,
  edited: string,
): string[] {
  const touched: string[] = [];
  for (const heading of managedHeadingsForFile(path)) {
    const before = findSectionRange(original, heading);
    if (!before) continue; // never managed in this file — prose-only edit
    const after = findSectionRange(edited, heading);
    const beforeBody = original.slice(before.bodyStart, before.end);
    const afterBody = after ? edited.slice(after.bodyStart, after.end) : null;
    if (afterBody === null || afterBody !== beforeBody) touched.push(heading);
  }
  return touched;
}
