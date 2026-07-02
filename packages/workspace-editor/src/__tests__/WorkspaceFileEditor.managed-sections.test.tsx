/**
 * Managed-section affordance in the SHARED WorkspaceFileEditor (Composer plan
 * U7). Asserted here — at the editor level, not in any one embedding surface —
 * because every writer of these source files (the Composer split view, Settings
 * → Workspace, the scoped space/user editors) inherits the affordance from this
 * component. CodeMirror is mocked to a plain textarea so edits are driven
 * deterministically in jsdom.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock CodeMirror to a controlled textarea so onChange edits are drivable.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    editable,
  }: {
    value: string;
    onChange?: (v: string) => void;
    editable?: boolean;
  }) => (
    <textarea
      data-testid="cm-editor"
      value={value}
      readOnly={editable === false}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

import { WorkspaceFileEditor } from "../components/WorkspaceFileEditor.js";
import type { WorkspaceFilesClient } from "../lib/workspace-files-client.js";

const DOC = [
  "# Agent",
  "",
  "Operator prose the human owns.",
  "",
  "## Skills & Tools",
  "",
  "- computed skill row",
  "",
  "## Notes",
  "",
  "More operator prose.",
  "",
].join("\n");

function makeClient(): WorkspaceFilesClient<Record<string, never>> & {
  putFile: ReturnType<typeof vi.fn>;
} {
  const putFile = vi.fn().mockResolvedValue(undefined);
  return {
    listFiles: vi.fn().mockResolvedValue({
      files: [{ path: "AGENTS.md", source: "agent", sha256: "" }],
    }),
    getFile: vi
      .fn()
      .mockResolvedValue({ content: DOC, source: "agent", sha256: "" }),
    putFile,
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
}

async function renderEditor() {
  const client = makeClient();
  render(
    <WorkspaceFileEditor
      target={{}}
      targetKey="agent-1"
      client={client}
      defaultOpenFile="AGENTS.md"
    />,
  );
  const editor = (await screen.findByTestId(
    "cm-editor",
  )) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.value).toContain("computed skill row"));
  return { client, editor };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("WorkspaceFileEditor managed-section affordance", () => {
  it("marks the computed managed sections present in the open file", async () => {
    await renderEditor();
    const note = await screen.findByTestId("managed-sections-note");
    expect(note.textContent).toContain("Skills & Tools");
    // Only the heading actually present is listed.
    expect(note.textContent).not.toContain("Folder Structure");
  });

  it("warns on save when an edit falls inside a computed section body", async () => {
    const { client, editor } = await renderEditor();
    fireEvent.change(editor, {
      target: {
        value: DOC.replace(
          "- computed skill row",
          "- computed skill row (operator tampered)",
        ),
      },
    });
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() => expect(client.putFile).toHaveBeenCalled());
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning.mock.calls[0]?.[0]).toContain("computed section");
  });

  it("does not warn when only operator prose outside managed sections is edited", async () => {
    const { client, editor } = await renderEditor();
    fireEvent.change(editor, {
      target: {
        value: DOC.replace(
          "Operator prose the human owns.",
          "Operator prose the human owns — reworded.",
        ),
      },
    });
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() => expect(client.putFile).toHaveBeenCalled());
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("disables the affordance when the host passes an empty heading list", async () => {
    const client = makeClient();
    render(
      <WorkspaceFileEditor
        target={{}}
        targetKey="agent-1"
        client={client}
        defaultOpenFile="AGENTS.md"
        managedSectionHeadings={[]}
      />,
    );
    const editor = (await screen.findByTestId(
      "cm-editor",
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain("computed skill row"));
    expect(screen.queryByTestId("managed-sections-note")).toBeNull();
    fireEvent.change(editor, {
      target: {
        value: DOC.replace("- computed skill row", "- tampered"),
      },
    });
    fireEvent.click(await screen.findByText("Save"));
    await waitFor(() => expect(client.putFile).toHaveBeenCalled());
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
