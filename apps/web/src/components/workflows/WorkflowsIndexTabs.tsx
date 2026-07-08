import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsRoutines } from "@/components/settings/SettingsRoutines";
import { WorkflowFormDialog } from "./WorkflowFormDialog";
import { WorkflowInventory } from "./WorkflowInventory";
import { WorkflowRunsList } from "./WorkflowRunsList";

export const WORKFLOWS_TABS = ["workflows", "routines", "executions"] as const;
export type WorkflowsTab = (typeof WORKFLOWS_TABS)[number];

/** Legacy `?tab=` values from earlier iterations / old redirects. */
export function normalizeWorkflowsTab(
  value: unknown,
): WorkflowsTab | undefined {
  if (value === "library") return "routines";
  if (value === "runs") return "executions";
  return WORKFLOWS_TABS.includes(value as WorkflowsTab)
    ? (value as WorkflowsTab)
    : undefined;
}

/**
 * The unified Workflows section (THINK-218): Workflows (inventory), Routines
 * (the git-backed deterministic step library), and Executions (tenant-wide
 * run ledger). Tab state lives in the `?tab=` search param; the tab strip and
 * the New-workflow action render in the page header like the unified Memory
 * layout.
 */
export function WorkflowsIndexTabs({ tab }: { tab: WorkflowsTab }) {
  const [createOpen, setCreateOpen] = useState(false);
  // Remount the inventory after a create so the fresh workflow shows up.
  const [inventoryEpoch, setInventoryEpoch] = useState(0);

  usePageHeaderActions({
    title: "Workflows",
    breadcrumbs: [{ label: "Workflows" }],
    tabs: [
      {
        to: "/settings/workflows",
        label: "Workflows",
        search: {},
        active: tab === "workflows",
      },
      {
        to: "/settings/workflows",
        label: "Routines",
        search: { tab: "routines" },
        active: tab === "routines",
      },
      {
        to: "/settings/workflows",
        label: "Executions",
        search: { tab: "executions" },
        active: tab === "executions",
      },
    ],
    action: (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            aria-label="New workflow"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="border border-border bg-popover text-popover-foreground shadow-md"
          arrowClassName="bg-popover fill-popover border-b border-r border-border"
        >
          New workflow
        </TooltipContent>
      </Tooltip>
    ),
    actionKey: `workflows-tabs:${tab}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {tab === "workflows" ? (
        <WorkflowInventory key={inventoryEpoch} embedded />
      ) : null}
      {tab === "executions" ? <WorkflowRunsList embedded /> : null}
      {tab === "routines" ? <SettingsRoutines embedded /> : null}
      <WorkflowFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => setInventoryEpoch((epoch) => epoch + 1)}
      />
    </div>
  );
}
