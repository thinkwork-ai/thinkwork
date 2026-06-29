import { ArrowLeft } from "lucide-react";
import { Button, cn } from "@thinkwork/ui";

import type { PrototypePageId } from "../data/model";
import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";
import { PROTOTYPE_PAGES } from "../fixtures/prototype-pages";
import { DiscoveryGuide } from "./DiscoveryGuide";
import { DiscoveryTool } from "./DiscoveryTool";
import { OpportunityPipeline } from "./OpportunityPipeline";
import { PreSessionBrief } from "./PreSessionBrief";
import { ValueAlignmentTool } from "./ValueAlignmentTool";

export function ToolWorkspace({
  activePageId,
  selectedAccount,
  selectedOpportunity,
  appOverlayBySection,
  opportunityOverlayBySection,
  appOverlayError,
  onBack,
  onPageChange,
  onSaveAppOverlay,
  onSaveOpportunityOverlay,
}: {
  activePageId: PrototypePageId;
  selectedAccount: EngagementAccount | null;
  selectedOpportunity: EngagementOpportunityWithLayers | null;
  appOverlayBySection: Map<string, Record<string, unknown>>;
  opportunityOverlayBySection: Map<string, Record<string, unknown>>;
  appOverlayError: string | null;
  onBack: () => void;
  onPageChange: (pageId: PrototypePageId) => void;
  onSaveAppOverlay: (
    sectionKey: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  onSaveOpportunityOverlay: (
    opportunityId: string,
    sectionKey: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const currentPage =
    PROTOTYPE_PAGES.find((page) => page.id === activePageId) ??
    PROTOTYPE_PAGES[0];

  return (
    <div className="min-h-full">
      <div className="border-b border-border p-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 size-3.5" />
          Dashboard
        </Button>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {currentPage.stepLabel ?? "Client Engagement App"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">
              {currentPage.title}
            </h2>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {selectedOpportunity
              ? selectedOpportunity.opportunity.name
              : (selectedAccount?.company.name ?? "No opportunity selected")}
          </div>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-4">
        {PROTOTYPE_PAGES.filter((page) => page.id !== "dashboard").map(
          (page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => onPageChange(page.id)}
              className={cn(
                "h-10 shrink-0 border-b-2 px-2 text-xs font-medium transition-colors",
                activePageId === page.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {page.routeSegment
                .split("-")
                .map((word) => word[0]?.toUpperCase() + word.slice(1))
                .join(" ")}
            </button>
          ),
        )}
      </div>

      <div className="p-4">
        {activePageId === "value-alignment" ? (
          <ValueAlignmentTool
            account={selectedAccount}
            opportunity={selectedOpportunity}
          />
        ) : null}
        {activePageId === "presession-brief" ? (
          <PreSessionBrief
            account={selectedAccount}
            opportunity={selectedOpportunity}
          />
        ) : null}
        {activePageId === "tool-guide" ? <DiscoveryGuide /> : null}
        {activePageId === "discovery-tool" ? (
          <DiscoveryTool
            account={selectedAccount}
            opportunity={selectedOpportunity}
            overlayBySection={opportunityOverlayBySection}
            onSaveOverlay={onSaveOpportunityOverlay}
            onOpenGuide={() => onPageChange("tool-guide")}
          />
        ) : null}
        {activePageId === "opportunity-pipeline" ? (
          <OpportunityPipeline
            overlayBySection={appOverlayBySection}
            overlayError={appOverlayError}
            onSaveOverlay={onSaveAppOverlay}
          />
        ) : null}
      </div>
    </div>
  );
}
