import { X } from "lucide-react";

import { usePanel } from "@/context/PanelContext";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 320;

export function PropertiesPanel() {
  const { isOpen, content, close } = usePanel();

  return (
    <aside
      className={cn(
        "fixed right-0 top-0 z-30 flex h-full flex-col border-l border-border bg-background transition-transform duration-200 ease-in-out",
        isOpen && content ? "translate-x-0" : "translate-x-full",
      )}
      style={{ width: PANEL_WIDTH }}
    >
      <div className="flex items-center justify-end border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={close}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">{content}</div>
    </aside>
  );
}
