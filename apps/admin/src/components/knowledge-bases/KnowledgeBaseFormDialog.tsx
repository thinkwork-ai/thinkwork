import { useState } from "react";
import { useMutation } from "urql";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/context/TenantContext";
import { CreateKnowledgeBaseMutation } from "@/lib/graphql-queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function KnowledgeBaseFormDialog({ open, onOpenChange, onSaved }: Props) {
  const { tenantId } = useTenant();
  const [, createKb] = useMutation(CreateKnowledgeBaseMutation);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chunkingStrategy, setChunkingStrategy] = useState("FIXED_SIZE");
  const [chunkSize, setChunkSize] = useState(300);
  const [overlapPercent, setOverlapPercent] = useState(20);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !tenantId) return;
    setSaving(true);
    try {
      const res = await createKb({
        input: {
          tenantId,
          name: name.trim(),
          description: description.trim() || undefined,
          chunkingStrategy,
          chunkSizeTokens: chunkSize,
          chunkOverlapPercent: overlapPercent,
        },
      });
      if (!res.error) {
        setName("");
        setDescription("");
        setChunkingStrategy("FIXED_SIZE");
        setChunkSize(300);
        setOverlapPercent(20);
        onSaved();
      }
    } catch (err) {
      console.error("Failed to create KB:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Knowledge Base</DialogTitle>
          <DialogDescription>
            Create a document-backed knowledge base for your agents.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
              placeholder="What documents are in this knowledge base?"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Chunking Strategy</Label>
            <Select value={chunkingStrategy} onValueChange={setChunkingStrategy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED_SIZE">Fixed Size</SelectItem>
                <SelectItem value="NONE">None (no chunking)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {chunkingStrategy === "FIXED_SIZE" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="kb-chunk-size">Chunk Size (tokens)</Label>
                <Input
                  id="kb-chunk-size"
                  type="number"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value) || 300)}
                  min={100}
                  max={1000}
                  step={50}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="kb-overlap">Overlap (%)</Label>
                <Input
                  id="kb-overlap"
                  type="number"
                  value={overlapPercent}
                  onChange={(e) => setOverlapPercent(Number(e.target.value) || 20)}
                  min={0}
                  max={50}
                  step={5}
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
