/**
 * CodeMirror decorations that visually mark managed-section bodies as
 * computed/locked in the WorkspaceFileEditor (Composer plan U7).
 *
 * These are purely visual: they do NOT block edits (the warn-on-save path in
 * WorkspaceFileEditor handles intent). Managed-section body lines get a subtle
 * background + left rule so an operator can see, before typing, that the region
 * is recomposed automatically and their edits there will not survive.
 */

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { findManagedSectionRanges } from "./managed-sections.js";

const managedHeadingLine = Decoration.line({
  attributes: { class: "cm-managed-heading" },
});
const managedBodyLine = Decoration.line({
  attributes: { class: "cm-managed-body" },
});

const managedSectionTheme = EditorView.theme({
  ".cm-managed-heading": {
    backgroundColor: "rgba(56, 189, 248, 0.08)",
  },
  ".cm-managed-body": {
    backgroundColor: "rgba(56, 189, 248, 0.06)",
    borderLeft: "2px solid rgba(56, 189, 248, 0.4)",
  },
});

function buildDecorations(
  view: EditorView,
  headings: readonly string[],
): DecorationSet {
  const doc = view.state.doc;
  const text = doc.toString();
  const ranges = findManagedSectionRanges(text, headings);
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of ranges) {
    // Decorate whole lines from the heading through the last body line.
    let pos = range.headingStart;
    const headingLine = doc.lineAt(range.headingStart);
    builder.add(headingLine.from, headingLine.from, managedHeadingLine);

    pos = range.bodyStart;
    const bodyEnd = Math.min(range.bodyEnd, doc.length);
    while (pos <= bodyEnd && pos <= doc.length) {
      const line = doc.lineAt(pos);
      if (line.from > headingLine.from) {
        builder.add(line.from, line.from, managedBodyLine);
      }
      if (line.to >= bodyEnd) break;
      pos = line.to + 1;
    }
  }

  return builder.finish();
}

/**
 * Build a CodeMirror extension that highlights managed-section bodies for the
 * given heading vocabulary. Recomputes on every document change.
 */
export function managedSectionHighlight(
  headings: readonly string[],
): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, headings);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, headings);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [managedSectionTheme, plugin];
}
