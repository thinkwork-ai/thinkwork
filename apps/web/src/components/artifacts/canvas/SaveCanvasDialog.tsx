import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { Save } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { SaveCanvasMutation, SpacesQuery } from "@/lib/graphql-queries";

interface SpacesResult {
  spaces?: Array<{ id: string; name?: string | null; slug?: string | null }>;
}

/**
 * Save affordance for a DRAFT canvas viewed via the artifact page (R10/R12/R15):
 * name it + assign a space (the caller's member spaces) → `saveCanvas`. Replaces
 * the retired promote-copy path for canvases (born-as-artifact: the row already
 * exists, so save is a status flip, not a copy).
 */
export function SaveCanvasDialog({
  artifactId,
  defaultTitle,
  onSaved,
}: {
  artifactId: string;
  defaultTitle: string;
  onSaved?: (spaceId: string) => void;
}) {
  const { tenantId } = useTenant();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [spaceId, setSpaceId] = useState<string>("");
  const [{ data: spacesData, fetching: spacesFetching }] =
    useQuery<SpacesResult>({
      query: SpacesQuery,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId || !open,
      requestPolicy: "cache-and-network",
    });
  const [{ fetching: saving }, saveCanvas] = useMutation(SaveCanvasMutation);

  const spaces = useMemo(() => spacesData?.spaces ?? [], [spacesData?.spaces]);
  const canSave = title.trim().length > 0 && spaceId.length > 0 && !saving;

  const handleSave = async () => {
    const result = await saveCanvas({
      artifactId,
      title: title.trim(),
      spaceId,
    });
    if (result.error || !result.data?.saveCanvas?.id) {
      toast.error(
        `Couldn't save canvas: ${result.error?.message ?? "unknown error"}`,
      );
      return;
    }
    toast.success(`Saved "${result.data.saveCanvas.title}"`);
    setOpen(false);
    onSaved?.(spaceId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" data-testid="save-canvas-open">
          <Save className="size-4" />
          Save
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="save-canvas-dialog">
        <DialogHeader>
          <DialogTitle>Save canvas</DialogTitle>
          <DialogDescription>
            Name this canvas and choose a space. Space members can open it
            without access to this thread.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Name</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Cost dashboard"
              data-testid="save-canvas-title"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Space</span>
            <Select value={spaceId} onValueChange={setSpaceId}>
              <SelectTrigger data-testid="save-canvas-space">
                <SelectValue
                  placeholder={
                    spacesFetching ? "Loading spaces…" : "Choose a space"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name?.trim() || space.slug || space.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            data-testid="save-canvas-submit"
          >
            {saving ? "Saving…" : "Save canvas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
