import { useMemo, useState } from "react";
import { Bookmark, Save, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { type WorkItemSavedViewSummary } from "./work-item-display";

const CURRENT = "__current__";

interface WorkItemSavedViewsProps {
  views: WorkItemSavedViewSummary[];
  activeViewId?: string;
  saving?: boolean;
  deleting?: boolean;
  onSelectView: (view: WorkItemSavedViewSummary | null) => void;
  onSaveView: (name: string) => Promise<boolean | void> | boolean | void;
  onDeleteView: (view: WorkItemSavedViewSummary) => Promise<void> | void;
}

export function WorkItemSavedViews({
  views,
  activeViewId,
  saving,
  deleting,
  onSelectView,
  onSaveView,
  onDeleteView,
}: WorkItemSavedViewsProps) {
  const [open, setOpen] = useState(false);
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId),
    [activeViewId, views],
  );
  const [name, setName] = useState(activeView?.name ?? "");

  return (
    <div className="flex items-center gap-2">
      <Select
        value={activeViewId ?? CURRENT}
        onValueChange={(value) => {
          if (value === CURRENT) {
            onSelectView(null);
            return;
          }
          const next = views.find((view) => view.id === value);
          if (next) onSelectView(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Saved Work Item view"
          className="w-48"
        >
          <Bookmark className="size-4" />
          <SelectValue placeholder="Current view" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CURRENT}>Current view</SelectItem>
          {views.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => {
          setName(activeView?.name ?? "");
          setOpen(true);
        }}
      >
        <Save className="size-4" />
        <span>Save</span>
      </Button>

      {activeView ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label={`Delete saved view ${activeView.name}`}
          disabled={deleting}
          onClick={() => void onDeleteView(activeView)}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Store the current filters, layout, and sort order.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              const saved = await onSaveView(trimmed);
              if (saved === false) return;
              setOpen(false);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="work-item-saved-view-name">Name</Label>
              <Input
                id="work-item-saved-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Blocked onboarding"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
