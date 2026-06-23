import { ClipboardCheck } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import type {
  AgentLoopDraft,
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";
import { AGENT_LOOP_PRESETS } from "./agent-loop-presets";

export function AutomationPresetSheet({
  open,
  onOpenChange,
  workerOptions,
  spaceOptions,
  defaultSpaceId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerOptions: AgentLoopWorkerOption[];
  spaceOptions: AgentLoopSpaceOption[];
  defaultSpaceId?: string | null;
  onSelect: (draft: AgentLoopDraft) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Templates</SheetTitle>
          <SheetDescription>
            Pick a configured template to prefill the Automation.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 divide-y divide-border rounded-md border border-border">
          {AGENT_LOOP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                onSelect(
                  preset.buildDraft(
                    workerOptions,
                    spaceOptions,
                    defaultSpaceId,
                  ),
                );
                onOpenChange(false);
              }}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{preset.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {preset.description}
                </span>
              </span>
              <ClipboardCheck className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
