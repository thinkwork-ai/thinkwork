/**
 * Shared selection-highlight extension (THINK-296). Selection visibility on
 * dark surfaces depends on two invariants asserted here: the shared theme
 * defines readable focused/unfocused/selection-match colors, and the house
 * editor surface never paints `.cm-content` opaquely (an opaque in-flow
 * content background hides the negative-z `.cm-selectionLayer`). Visual proof
 * is owned by the browser verification contract; jsdom does not paint.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture CodeMirror props so we can assert on the extensions the pane wires.
const capturedProps: Record<string, unknown>[] = [];
vi.mock("@uiw/react-codemirror", () => ({
  default: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-testid="cm-editor" />;
  },
}));

import {
  editorSelectionHighlight,
  selectionHighlightSpec,
} from "../lib/selection-highlight.js";
import {
  FileEditorPane,
  houseEditorSurfaceSpec,
} from "../components/FileEditorPane.js";

afterEach(() => {
  cleanup();
  capturedProps.length = 0;
});

describe("editorSelectionHighlight", () => {
  it("is a non-empty extension with focused, unfocused, and selection-match arms", () => {
    expect(editorSelectionHighlight).toBeTruthy();

    const focused =
      selectionHighlightSpec["&.cm-focused .cm-selectionBackground"]
        .backgroundColor;
    const unfocused =
      selectionHighlightSpec[".cm-selectionBackground"].backgroundColor;
    const match = selectionHighlightSpec[".cm-selectionMatch"].backgroundColor;

    for (const color of [focused, unfocused, match]) {
      expect(color).toContain("var(--primary)");
      expect(color).not.toContain("transparent !");
    }
    // Focused and unfocused must both out-cascade vscodeDark's !important.
    expect(focused).toContain("!important");
    expect(unfocused).toContain("!important");
    // The three tints stay distinguishable from each other (R3).
    expect(new Set([focused, unfocused, match]).size).toBe(3);
  });
});

describe("houseEditorSurfaceSpec", () => {
  it("never assigns a background to .cm-content (would occlude the selection layer)", () => {
    for (const [selector, decl] of Object.entries(houseEditorSurfaceSpec)) {
      if (!selector.includes(".cm-content")) continue;
      expect(decl).not.toHaveProperty("backgroundColor");
      expect(decl).not.toHaveProperty("background");
    }
    // The muted surface is still carried below the layer.
    expect(houseEditorSurfaceSpec["&"].backgroundColor).toContain(
      "var(--muted)",
    );
    expect(houseEditorSurfaceSpec[".cm-scroller"].backgroundColor).toContain(
      "var(--muted)",
    );
  });

  it("defines no selection colors of its own (single source of truth, R6)", () => {
    expect(JSON.stringify(houseEditorSurfaceSpec)).not.toContain("selection");
  });
});

describe("FileEditorPane", () => {
  it("passes editorSelectionHighlight in the CodeMirror extensions (AE1, structural)", () => {
    render(
      <FileEditorPane
        openFile="AGENTS.md"
        content="hello"
        value="hello"
        loading={false}
        saving={false}
        onChange={() => {}}
        onSave={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(capturedProps.length).toBeGreaterThan(0);
    const extensions = capturedProps[0].extensions as unknown[];
    expect(extensions).toContain(editorSelectionHighlight);
  });
});
