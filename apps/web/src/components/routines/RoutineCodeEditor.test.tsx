import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub CodeMirror to a plain element and capture props so the wired
// extensions can be asserted on without the real editor runtime in jsdom.
const codeMirrorProps: Record<string, unknown>[] = [];
vi.mock("@uiw/react-codemirror", () => ({
  default: (props: { value: string }) => {
    codeMirrorProps.push(props);
    return <div data-testid="routine-codemirror" data-value={props.value} />;
  },
}));

import { editorSelectionHighlight } from "@thinkwork/workspace-editor";
import { RoutineCodeEditor } from "./RoutineCodeEditor";

afterEach(() => {
  cleanup();
  codeMirrorProps.length = 0;
});

describe("RoutineCodeEditor", () => {
  it("wires the shared selection highlight into the editor (THINK-296 AE2)", () => {
    render(
      <RoutineCodeEditor
        value="print('hi')"
        language="python"
        onChange={() => {}}
      />,
    );
    expect(codeMirrorProps.length).toBeGreaterThan(0);
    const extensions = codeMirrorProps[0].extensions as unknown[];
    expect(extensions).toContain(editorSelectionHighlight);
  });
});
