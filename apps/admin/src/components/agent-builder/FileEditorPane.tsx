import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Eye, File, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoutingTableEditor } from "./RoutingTableEditor";
import { parseRoutingTable } from "./routing-table";
import { languageForFile } from "@/lib/codemirror-language";

export interface FileEditorPaneProps {
  openFile: string | null;
  content: string;
  value: string;
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDeleteConfirm: () => void;
}

export function FileEditorPane({
  openFile,
  content,
  value,
  loading,
  saving,
  deleting,
  confirmingDelete,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  onConfirmDelete,
  onCancelDeleteConfirm,
}: FileEditorPaneProps) {
  const [editingMarkdown, setEditingMarkdown] = useState(true);

  useEffect(() => {
    setEditingMarkdown(true);
  }, [openFile]);

  if (!openFile) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a file
      </div>
    );
  }

  const fileName = openFile.split("/").pop() ?? openFile;
  const isMarkdown = openFile.endsWith(".md");
  const showMarkdownPreview = isMarkdown && !editingMarkdown;
  const isAgentsMd = openFile.endsWith("AGENTS.md");
  const routingState = isAgentsMd ? parseRoutingTable(value) : null;

  return (
    <>
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
          {!loading && (
            <>
              {isMarkdown && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setEditingMarkdown((current) => !current)}
                >
                  {showMarkdownPreview ? (
                    <>
                      <Pencil className="mr-1 h-3 w-3" />
                      Edit
                    </>
                  ) : (
                    <>
                      <Eye className="mr-1 h-3 w-3" />
                      Preview
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground"
                onClick={onDiscard}
                disabled={saving || value === content}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={onSave}
                disabled={saving || value === content}
              >
                {saving ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-6 p-0 ${
                  confirmingDelete
                    ? "w-auto rounded-full border border-destructive/45 bg-transparent px-1.5 text-[11px] font-semibold leading-none text-destructive shadow-none transition-none hover:border-destructive/65 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/25"
                    : "w-6 text-muted-foreground/65 transition-none hover:text-foreground"
                }`}
                aria-label={
                  confirmingDelete ? "Confirm delete file" : "Delete file"
                }
                disabled={deleting}
                onMouseLeave={onCancelDeleteConfirm}
                onClick={confirmingDelete ? onDelete : onConfirmDelete}
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : confirmingDelete ? (
                  "Confirm"
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
      {isAgentsMd && !loading && !showMarkdownPreview && (
        <RoutingTableEditor value={value} onChange={onChange} />
      )}
      <div className="min-h-0 flex-1 overflow-hidden bg-black [&>div]:h-full">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : showMarkdownPreview ? (
          <div className="h-full overflow-y-auto bg-background p-5">
            <div className="prose prose-sm prose-invert max-w-none [&_code]:break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_table]:w-full [&_table]:table-fixed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <CodeMirror
            value={value}
            onChange={onChange}
            height="100%"
            theme={vscodeDark}
            extensions={[...languageForFile(openFile), EditorView.lineWrapping]}
            style={{ fontSize: "12px", backgroundColor: "black" }}
            className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              bracketMatching: true,
            }}
          />
        )}
      </div>
    </>
  );
}
