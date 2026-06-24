import { useMemo } from "react";
import { Binoculars, Check, Trash2 } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@thinkwork/ui";
import { type WorkItemSavedViewSummary } from "./work-item-display";

interface WorkItemSavedViewsProps {
  views: WorkItemSavedViewSummary[];
  activeViewId?: string;
  deleting?: boolean;
  onSelectView: (view: WorkItemSavedViewSummary | null) => void;
  onDeleteView: (view: WorkItemSavedViewSummary) => Promise<void> | void;
}

export function WorkItemSavedViews({
  views,
  activeViewId,
  deleting,
  onSelectView,
  onDeleteView,
}: WorkItemSavedViewsProps) {
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId),
    [activeViewId, views],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Work Item views"
          title="Work Item views"
        >
          <Binoculars className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <ViewOption
          active={!activeViewId}
          label="Current view"
          onClick={() => onSelectView(null)}
        />
        {views.map((view) => (
          <ViewOption
            key={view.id}
            active={view.id === activeViewId}
            label={view.name}
            onClick={() => onSelectView(view)}
          />
        ))}

        {activeView ? (
          <div className="mt-1 border-t border-border pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
              aria-label={`Delete saved view ${activeView.name}`}
              disabled={deleting}
              onClick={() => void onDeleteView(activeView)}
            >
              <Trash2 className="size-4" />
              Delete view
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ViewOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-start gap-2"
      onClick={onClick}
    >
      <span className="flex size-4 items-center justify-center">
        {active ? <Check className="size-3.5" /> : null}
      </span>
      <span className="truncate">{label}</span>
    </Button>
  );
}
