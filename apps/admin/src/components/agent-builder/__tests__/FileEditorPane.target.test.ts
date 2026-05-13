import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fileEditorPaneSource = readFileSync(
  new URL("../FileEditorPane.tsx", import.meta.url),
  "utf8",
);

describe("FileEditorPane CodeMirror language wiring", () => {
  it("routes CodeMirror language through the shared languageForFile helper", () => {
    expect(fileEditorPaneSource).toMatch(
      /import\s+\{\s*languageForFile\s*\}\s+from\s+["']@\/lib\/codemirror-language["']/,
    );
    expect(fileEditorPaneSource).toMatch(
      /extensions=\{\[\s*\.\.\.languageForFile\(openFile\),/,
    );
  });

  it("no longer hardcodes the markdown language in the editor extensions", () => {
    // The markdown language extension should only reach CodeMirror via
    // languageForFile() — and only for .md files. There should be no direct
    // markdown() call in the editor extensions array any more.
    expect(fileEditorPaneSource).not.toMatch(
      /from\s+["']@codemirror\/lang-markdown["']/,
    );
    expect(fileEditorPaneSource).not.toMatch(
      /from\s+["']@codemirror\/language-data["']/,
    );
  });
});
