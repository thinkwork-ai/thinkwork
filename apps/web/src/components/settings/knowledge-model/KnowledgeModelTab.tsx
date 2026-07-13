import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";
import { IdentityList } from "./IdentityList";
import { ResolutionQueue } from "./ResolutionQueue";

type KnowledgeModelView = "definitions" | "identity" | "resolution-queue";

const VIEW_TITLES: Record<
  KnowledgeModelView,
  { title: string; description: string }
> = {
  definitions: {
    title: "Definitions",
    description: "Inspect approved terms and relationship definitions.",
  },
  identity: {
    title: "Identity",
    description:
      "Canonical entity instances and their exact source mappings. Merged entities persist as redirects.",
  },
  "resolution-queue": {
    title: "Resolution Queue",
    description:
      "Open ambiguity cases awaiting an operator decision: link to an existing canonical entity, create a new one, defer, or reject.",
  },
};

// Sized to the longest title ("Resolution Queue") so the badge-slot toggle
// group doesn't shift horizontally when a shorter title swaps in.
const TITLE_MIN_WIDTH_CLASS = "min-w-52";

/**
 * Model tab of the unified Memory page (THINK-193 U4). Owns a single title row
 * — the active sub-view's title/description with the view toggle group inline
 * beside it — over three content-only sub-views: term Definitions (the
 * pre-existing knowledge-graph tab content), the canonical-entity Identity
 * list, and the entity Resolution Queue. Sub-view selection is component-local
 * state so the existing /settings/memory/ontology route keeps working
 * unchanged.
 */
export function KnowledgeModelTab() {
  const [view, setView] = useState<KnowledgeModelView>("definitions");
  const { title, description } = VIEW_TITLES[view];

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title={title}
        description={description}
        titleClassName={TITLE_MIN_WIDTH_CLASS}
        badge={
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) =>
              value && setView(value as KnowledgeModelView)
            }
            variant="outline"
            aria-label="Model view"
          >
            <ToggleGroupItem value="definitions" className="px-3 text-xs">
              Definitions
            </ToggleGroupItem>
            <ToggleGroupItem value="identity" className="px-3 text-xs">
              Identity
            </ToggleGroupItem>
            <ToggleGroupItem value="resolution-queue" className="px-3 text-xs">
              Resolution Queue
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <div className="min-h-0 flex-1">
        {view === "definitions" ? <KnowledgeGraphTab /> : null}
        {view === "identity" ? <IdentityList /> : null}
        {view === "resolution-queue" ? <ResolutionQueue /> : null}
      </div>
    </div>
  );
}
