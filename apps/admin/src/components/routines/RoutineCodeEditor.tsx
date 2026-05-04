import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { EditorView } from "@codemirror/view";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RoutineCodeLanguage = "python" | "typescript";

interface RoutineCodeEditorProps {
  id?: string;
  value: string;
  language: RoutineCodeLanguage;
  readOnly?: boolean;
  error?: boolean;
  stacked?: boolean;
  labelledBy?: string;
  onChange: (value: string) => void;
}

export function RoutineCodeEditor({
  id,
  value,
  language,
  readOnly = false,
  error = false,
  stacked = false,
  labelledBy,
  onChange,
}: RoutineCodeEditorProps) {
  return (
    <div
      id={id}
      className={cn(
        "overflow-hidden rounded-md border bg-black",
        error ? "border-destructive" : "border-input",
        readOnly && "opacity-80",
      )}
      aria-invalid={error}
      aria-labelledby={labelledBy}
    >
      <div className="flex h-8 items-center justify-between border-b border-white/10 bg-zinc-950 px-2.5">
        <Badge
          variant="outline"
          className="h-5 border-white/15 font-mono text-[10px] text-zinc-300"
        >
          {language}
        </Badge>
        {readOnly && (
          <span className="text-[10px] text-zinc-500">Read-only</span>
        )}
      </div>
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!readOnly}
        readOnly={readOnly}
        height={stacked ? "420px" : "260px"}
        theme={vscodeDark}
        extensions={[
          language === "typescript"
            ? javascript({ jsx: true, typescript: true })
            : python(),
          EditorView.lineWrapping,
        ]}
        style={{ fontSize: "12px", backgroundColor: "black" }}
        className="[&_.cm-editor]:!bg-black [&_.cm-gutters]:!bg-black [&_.cm-activeLine]:!bg-transparent [&_.cm-activeLineGutter]:!bg-transparent"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          bracketMatching: true,
          autocompletion: true,
        }}
      />
    </div>
  );
}
