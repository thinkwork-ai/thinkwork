import { useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsRoutines } from "@/components/settings/SettingsRoutines";
import { WorkflowInventory } from "./WorkflowInventory";
import { WorkflowRunsList } from "./WorkflowRunsList";

export const WORKFLOWS_TABS = ["workflows", "runs", "library"] as const;
export type WorkflowsTab = (typeof WORKFLOWS_TABS)[number];

/**
 * The unified Workflows section (THINK-218): Workflows (inventory), Runs
 * (tenant-wide run ledger), and Library (the git-backed Routines list,
 * reused as the step library). Tab state lives in the `?tab=` search param
 * so links/back-forward behave like every other tabbed settings page.
 */
export function WorkflowsIndexTabs({ tab }: { tab: WorkflowsTab }) {
  const navigate = useNavigate();

  usePageHeaderActions({
    title: "Workflows",
    breadcrumbs: [{ label: "Workflows" }],
    actionKey: `workflows-tabs:${tab}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: "/settings/workflows",
            search: value === "workflows" ? {} : { tab: value as WorkflowsTab },
          })
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList
          variant="line"
          className="mx-6 mt-6 w-auto shrink-0 justify-start border-b"
        >
          <TabsTrigger value="workflows" className="flex-none px-3">
            Workflows
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex-none px-3">
            Runs
          </TabsTrigger>
          <TabsTrigger value="library" className="flex-none px-3">
            Library
          </TabsTrigger>
        </TabsList>
        <TabsContent value="workflows" className="min-h-0 flex-1">
          <WorkflowInventory embedded />
        </TabsContent>
        <TabsContent value="runs" className="min-h-0 flex-1">
          <WorkflowRunsList embedded />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1">
          <SettingsRoutines embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
