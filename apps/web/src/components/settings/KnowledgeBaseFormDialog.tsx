import { useEffect, useState } from "react";
import { useMutation } from "urql";
import { Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  CreateKnowledgeBaseMutation,
  UpdateKnowledgeBaseMutation,
} from "@/lib/kb-queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /**
   * When provided, the dialog edits this KB's name + description instead of
   * creating a new one. Chunking is edited in the detail page's own section, so
   * edit mode intentionally omits the chunking controls.
   */
  kb?: { id: string; name: string; description?: string | null };
}

export function KnowledgeBaseFormDialog({
  open,
  onOpenChange,
  onSaved,
  kb,
}: Props) {
  const isEdit = !!kb;
  const { tenantId } = useTenant();
  const [{ fetching: creating }, createKb] = useMutation(
    CreateKnowledgeBaseMutation,
  );
  const [{ fetching: updating }, updateKb] = useMutation(
    UpdateKnowledgeBaseMutation,
  );
  const saving = creating || updating;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chunkingStrategy, setChunkingStrategy] = useState("FIXED_SIZE");
  const [chunkSize, setChunkSize] = useState(300);
  const [overlap, setOverlap] = useState(20);
  const [error, setError] = useState<string | null>(null);

  // Reset / prefill whenever the dialog opens (so reopening edit on a different
  // KB doesn't show stale values from the previous open).
  useEffect(() => {
    if (!open) return;
    setName(kb?.name ?? "");
    setDescription(kb?.description ?? "");
    setChunkingStrategy("FIXED_SIZE");
    setChunkSize(300);
    setOverlap(20);
    setError(null);
  }, [open, kb]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setError(null);

    if (isEdit) {
      const res = await updateKb({
        id: kb.id,
        input: {
          name: name.trim(),
          description: description.trim() || null,
        },
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
    } else {
      if (!tenantId) return;
      const res = await createKb({
        input: {
          tenantId,
          name: name.trim(),
          description: description.trim() || undefined,
          chunkingStrategy,
          chunkSizeTokens: chunkSize,
          chunkOverlapPercent: overlap,
        },
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
    }

    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit source" : "Create source"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit ? (
            <p className="text-sm text-muted-foreground">
              Create a document-backed Knowledge Base. Retained documents are
              added to Hindsight Space memory.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="kb-name">Name</Label>
            <Input
              id="kb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Company Policies"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kb-desc">Description</Label>
            <Textarea
              id="kb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What documents are in this source?"
              rows={2}
            />
          </div>

          {!isEdit ? (
            <>
              <div className="space-y-1.5">
                <Label>Chunking strategy</Label>
                <Select
                  value={chunkingStrategy}
                  onValueChange={setChunkingStrategy}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED_SIZE">Fixed size</SelectItem>
                    <SelectItem value="NONE">None (no chunking)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {chunkingStrategy === "FIXED_SIZE" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="kb-chunk-size">Chunk size (tokens)</Label>
                    <Input
                      id="kb-chunk-size"
                      type="number"
                      value={chunkSize}
                      min={100}
                      max={1000}
                      step={50}
                      onChange={(e) =>
                        setChunkSize(Number(e.target.value) || 300)
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kb-overlap">Overlap (%)</Label>
                    <Input
                      id="kb-overlap"
                      type="number"
                      value={overlap}
                      min={0}
                      max={50}
                      step={5}
                      onChange={(e) => setOverlap(Number(e.target.value) || 20)}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={saving || !name.trim()}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
