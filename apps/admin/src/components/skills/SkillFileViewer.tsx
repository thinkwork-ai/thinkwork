import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, Eye, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  content: string;
  editable: boolean;
  onSave?: (content: string) => Promise<void>;
};

export function SkillFileViewer({ content, editable, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {editable && (
        <div className="flex items-center gap-2 pb-3 border-b border-border mb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (editing) {
                setDraft(content);
              }
              setEditing(!editing);
            }}
          >
            {editing ? (
              <>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </>
            )}
          </Button>
          {editing && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Save
            </Button>
          )}
        </div>
      )}

      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 min-h-[400px] font-mono text-xs resize-none"
        />
      ) : (
        <div className="prose prose-sm prose-invert max-w-none [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words [&_table]:table-fixed [&_table]:w-full">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
