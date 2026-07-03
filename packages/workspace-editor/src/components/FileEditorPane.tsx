import { useMemo, type ReactNode } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import { File, Loader2, Lock } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { languageForFile } from "../lib/codemirror-language.js";
import { managedSectionHighlight } from "../lib/managed-section-decorations.js";
import { managedSectionHeadingsPresent } from "../lib/managed-sections.js";

// House editor surface: the CodeMirror chrome (editor/scroller/gutters) reads as
// the app's muted grey surface token — the same family as the tree/side panels —
// instead of a stark black rectangle, and fills its container to the bottom
// (`.cm-editor { height: 100% }`). Backgrounds carry `!important` to win over the
// imported `vscodeDark` theme; syntax token FOREGROUND colors are left to
// vscodeDark for now (a follow-up decision). Applies to every editor surface on
// the page (main pane + split-view source pane) and to every other embed of the
// shared editor (Settings → Workspace, scoped space/user editors).
const houseEditorSurface = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--muted) !important",
    color: "var(--foreground)",
  },
  ".cm-scroller": { backgroundColor: "var(--muted) !important" },
  ".cm-content": {
    backgroundColor: "var(--muted) !important",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--muted) !important",
    color: "var(--muted-foreground)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-gutter": { backgroundColor: "var(--muted) !important" },
  ".cm-lineNumbers": { backgroundColor: "var(--muted) !important" },
  ".cm-foldGutter": { backgroundColor: "var(--muted) !important" },
  ".cm-gutterElement": { backgroundColor: "var(--muted) !important" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  // Keep a visible selection on the grey surface (drawn layer + native).
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor:
        "color-mix(in oklab, var(--primary) 24%, transparent) !important",
    },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
  },
});

export interface FileEditorPaneProps {
  openFile: string | null;
  content: string;
  value: string;
  loading: boolean;
  saving: boolean;
  readOnly?: boolean;
  /**
   * Managed-heading vocabulary. Bodies of these `## ` sections are recomputed
   * by the composer, so they render marked/locked and edits inside them warn
   * on save (Composer plan U7). Empty disables the affordance.
   */
  managedHeadings?: readonly string[];
  /**
   * Extra badges rendered in the standard header row, right after the filename
   * (e.g. the Composer's generated / layer-source / read-only / size badges).
   * Keeps a single house header instead of a second outer one.
   */
  headerBadges?: ReactNode;
  /**
   * Extra actions rendered at the far right of the header row, after
   * Save/Discard (e.g. the Composer's Close button).
   */
  headerActions?: ReactNode;
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
  managedHeadings,
  headerBadges,
  headerActions,
  onChange,
  onSave,
  onDiscard,
}: FileEditorPaneProps) {
  const headings = managedHeadings ?? [];
  const managedPresent = useMemo(
    () =>
      headings.length > 0 ? managedSectionHeadingsPresent(value, headings) : [],
    [value, headings],
  );
  const managedExtension = useMemo(
    () => (headings.length > 0 ? [managedSectionHighlight(headings)] : []),
    [headings],
  );

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
          {headerBadges}
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
          {headerActions}
        </div>
      </div>
      {managedPresent.length > 0 ? (
        <div
          className="flex items-center gap-1.5 border-b bg-sky-500/5 px-3 py-1.5 text-[11px] text-muted-foreground"
          data-testid="managed-sections-note"
        >
          <Lock className="h-3 w-3 shrink-0 text-sky-500" />
          <span className="min-w-0">
            Computed section{managedPresent.length > 1 ? "s" : ""} (recomposed
            automatically — edits inside will not be saved):{" "}
            <span className="font-medium text-foreground">
              {managedPresent.join(", ")}
            </span>
          </span>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden bg-muted [&>div]:h-full">
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
              ...managedExtension,
              EditorView.lineWrapping,
              houseEditorSurface,
            ]}
            editable={!readOnly}
            style={{ fontSize: "12px" }}
            className="h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto"
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
