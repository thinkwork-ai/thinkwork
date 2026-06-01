import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import { File, Loader2 } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { languageForFile } from "../lib/codemirror-language.js";

const blackEditorSurface = EditorView.theme({
  "&": { backgroundColor: "black" },
  ".cm-scroller": { backgroundColor: "black" },
  ".cm-content": { backgroundColor: "black" },
  ".cm-gutters": { backgroundColor: "black" },
  ".cm-gutter": { backgroundColor: "black" },
  ".cm-lineNumbers": { backgroundColor: "black" },
  ".cm-foldGutter": { backgroundColor: "black" },
  ".cm-gutterElement": { backgroundColor: "black" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "black" },
  // Forcing the surface black hid the selection highlight — restore a visible
  // selection for both the drawn layer (focused + blurred) and native selection.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "#264f78 !important" },
  ".cm-selectionMatch": { backgroundColor: "#3a3d41" },
});

export interface FileEditorPaneProps {
  openFile: string | null;
  content: string;
  value: string;
  loading: boolean;
  saving: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function FileEditorPane({
  openFile,
  content,
  value,
  loading,
  saving,
  readOnly = false,
  onChange,
  onSave,
  onDiscard,
}: FileEditorPaneProps) {
  if (!openFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a file
      </div>
    );
  }

  const fileName = openFile.split("/").pop() ?? openFile;
  const hasPendingChanges = value !== content;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between border-b bg-muted/50 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{fileName}</span>
          {openFile.includes("/") && (
            <span className="truncate text-[10px] text-muted-foreground">
              {openFile}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!readOnly && !loading && hasPendingChanges && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                onClick={onDiscard}
                disabled={saving}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Save
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-black [&>div]:h-full">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <CodeMirror
            value={value}
            onChange={onChange}
            height="100%"
            theme={vscodeDark}
            extensions={[
              ...languageForFile(openFile),
              EditorView.lineWrapping,
              blackEditorSurface,
            ]}
            editable={!readOnly}
            style={{ fontSize: "12px", backgroundColor: "black" }}
            className="[&_.cm-editor]:!h-full [&_.cm-editor]:!bg-black [&_.cm-scroller]:!overflow-auto [&_.cm-scroller]:!bg-black [&_.cm-content]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-gutter]:!bg-black [&_.cm-lineNumbers]:!bg-black [&_.cm-foldGutter]:!bg-black [&_.cm-gutterElement]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-black"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              bracketMatching: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
