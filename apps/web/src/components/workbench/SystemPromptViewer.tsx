import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";

// Above this size we drop markdown highlighting so a very large composed
// prompt (tens of KB) renders without the parser stalling the viewer.
const HIGHLIGHT_MAX_CHARS = 50_000;

export interface SystemPromptViewerProps {
  /**
   * The exact captured prompt text. When empty, the viewer renders nothing —
   * callers own the empty state because the copy differs per surface.
   */
  prompt: string;
  /** Toast shown after a successful copy. */
  copyToastLabel?: string;
}

/**
 * Read-only viewer for a captured system prompt: a line-numbered, wrapping
 * CodeMirror pane plus a Copy button. Presentational — it takes the prompt
 * string directly and never selects or fetches turns. Shared by the thread
 * execution-trace Agent modal and the thread `SystemPromptDialog`.
 */
export function SystemPromptViewer({
  prompt,
  copyToastLabel = "System prompt copied.",
}: SystemPromptViewerProps) {
  const extensions = useMemo(() => {
    // Keep the editor out of the Tab order so it doesn't trap keyboard focus
    // inside the dialog — the Copy button and the dialog close control stay
    // reachable by keyboard.
    const base = [
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({ tabindex: "-1" }),
    ];
    return prompt.length > HIGHLIGHT_MAX_CHARS ? base : [markdown(), ...base];
  }, [prompt.length]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(copyToastLabel);
    } catch (err) {
      console.error("[SystemPromptViewer] clipboard write failed", err);
      toast.error("Could not copy the system prompt.");
    }
  }

  if (prompt.length === 0) return null;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-black">
        <CodeMirror
          value={prompt}
          height="100%"
          theme={vscodeDark}
          extensions={extensions}
          editable={false}
          readOnly
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
          style={{ fontSize: "12px", height: "60vh" }}
          className="[&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto"
        />
      </div>
      <div className="flex shrink-0 justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          data-testid="system-prompt-copy"
        >
          <Copy className="mr-2 h-4 w-4" />
          Copy
        </Button>
      </div>
    </>
  );
}
