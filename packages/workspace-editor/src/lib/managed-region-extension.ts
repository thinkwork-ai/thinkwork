/**
 * CodeMirror affordance for managed (computed) sections: every line inside a
 * managed section body gets a `cm-managedLine` background so the region reads
 * as locked/derived, and the heading line gets a `cm-managedHeading` marker.
 * Ranges are recomputed from the live document on every edit so the marking
 * tracks the text as the operator types around it.
 */

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import { findManagedSectionRanges } from "./managed-sections.js";

const managedLine = Decoration.line({ class: "cm-managedLine" });
const managedHeadingLine = Decoration.line({ class: "cm-managedHeading" });

const managedTheme = EditorView.baseTheme({
  ".cm-managedLine": {
    backgroundColor: "rgba(148, 163, 184, 0.09)",
  },
  ".cm-managedHeading": {
    backgroundColor: "rgba(148, 163, 184, 0.09)",
  },
  ".cm-managedHeading::after": {
    content: '"computed"',
    marginLeft: "0.75rem",
    fontSize: "0.65rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "rgba(148, 163, 184, 0.7)",
  },
});

function buildDecorations(view: EditorView, path: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const ranges = findManagedSectionRanges(path, doc.toString());
  for (const range of ranges) {
    const firstLine = doc.lineAt(Math.min(range.headingStart, doc.length));
    const lastOffset = Math.min(Math.max(range.end - 1, 0), doc.length);
    const lastLine = doc.lineAt(lastOffset);
    for (let n = firstLine.number; n <= lastLine.number; n++) {
      const line = doc.line(n);
      builder.add(
        line.from,
        line.from,
        n === firstLine.number ? managedHeadingLine : managedLine,
      );
    }
  }
  return builder.finish();
}

/** Marks managed-section regions in a file; inert when the file has none. */
export function managedRegionExtension(path: string): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, path);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.view, path);
        }
      }
    },
    { decorations: (instance) => instance.decorations },
  );
  return [plugin, managedTheme];
}
