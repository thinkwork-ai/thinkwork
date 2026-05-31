import { IconFiles, IconInfoCircle } from "@tabler/icons-react";
import { Button, cn } from "@thinkwork/ui";
import {
  desktopToolbarActiveButtonClassName,
  desktopToolbarButtonClassName,
} from "@/lib/desktop-chrome";

/**
 * Single icon button that toggles a settings detail page between its
 * Information view and its Workspace files view. Shows the *destination*
 * icon (files while on info, info while on workspace) and marks current
 * state via `aria-pressed` + an active highlight when the workspace view
 * is open. Published into the settings header bar's action slot.
 */
export function WorkspaceViewToggle({
  showingWorkspace,
  onToggle,
}: {
  showingWorkspace: boolean;
  onToggle: () => void;
}) {
  const label = showingWorkspace ? "Show information" : "Open workspace files";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={showingWorkspace}
      title={label}
      className={cn(
        "size-8",
        showingWorkspace
          ? desktopToolbarActiveButtonClassName
          : desktopToolbarButtonClassName,
      )}
      onClick={onToggle}
    >
      {showingWorkspace ? (
        <IconInfoCircle className="size-4" />
      ) : (
        <IconFiles className="size-4" />
      )}
    </Button>
  );
}
