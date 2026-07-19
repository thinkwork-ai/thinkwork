import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@thinkwork/ui";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";
import { IdentityList } from "./IdentityList";
import type { OntologyFocus } from "./OntologyCandidateSheet";
import { OntologyMapView } from "./OntologyMapView";
import { OntologyPacksView } from "./OntologyPacksView";
import { ResolutionQueue } from "./ResolutionQueue";

type KnowledgeModelView =
  | "map"
  | "packs"
  | "definitions"
  | "identity"
  | "resolution-queue";

const VIEW_TITLES: Record<
  KnowledgeModelView,
  { title: string; description: string }
> = {
  map: {
    title: "Living Map",
    description:
      "Your domain's schema graph. Ghost nodes are pending candidates — focus one to review its evidence, or add a triple directly on the canvas.",
  },
  packs: {
    title: "Starter Packs",
    description:
      "Installable domain-schema bundles. Installing stages the pack's types as a pending change set for review — nothing applies without approval.",
  },
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

const VIEW_OPTIONS: ReadonlyArray<{
  value: KnowledgeModelView;
  label: string;
}> = [
  { value: "map", label: "Living Map" },
  { value: "packs", label: "Starter Packs" },
  { value: "definitions", label: "Definitions" },
  { value: "identity", label: "Identity" },
  { value: "resolution-queue", label: "Resolution Queue" },
];

/**
 * Ontology tab of the unified Memory page (THINK-193 U4). The active
 * sub-view's title is also the view selector, keeping the page hierarchy clear
 * across five content-only views: the Living Map schema canvas (THINK-320 U6,
 * KTD-8 — the default landing view), the Starter Packs browser (THINK-320
 * U7), term Definitions (the pre-existing knowledge-graph tab content), the
 * canonical-entity Identity list, and the entity Resolution Queue. Selection
 * is component-local state so the existing
 * /settings/memory/ontology route keeps working unchanged.
 */
export function KnowledgeModelTab() {
  const [view, setView] = useState<KnowledgeModelView>("map");
  // Pack-install handoff (THINK-320 U7, AE4): the packs view stages a change
  // set and asks the map to open it in the review flow. Cleared once the map
  // captures it so a later return to the map doesn't re-open the sheet.
  const [pendingFocus, setPendingFocus] = useState<OntologyFocus | null>(null);
  const { title, description } = VIEW_TITLES[view];

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group -ml-2 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 data-[state=open]:bg-muted/60"
                aria-label={`Ontology view: ${title}`}
              >
                <span>{title}</span>
                <ChevronDown
                  className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              aria-label="Ontology views"
            >
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(value) => setView(value as KnowledgeModelView)}
              >
                {VIEW_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="px-2 py-1.5 pr-8"
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        description={description}
      />
      <div className="min-h-0 flex-1">
        {view === "map" ? (
          <OntologyMapView
            initialFocus={pendingFocus}
            onInitialFocusConsumed={() => setPendingFocus(null)}
            onOpenPacks={() => setView("packs")}
          />
        ) : null}
        {view === "packs" ? (
          <OntologyPacksView
            onOpenChangeSet={(focus) => {
              setPendingFocus(focus);
              setView("map");
            }}
          />
        ) : null}
        {view === "definitions" ? <KnowledgeGraphTab /> : null}
        {view === "identity" ? <IdentityList /> : null}
        {view === "resolution-queue" ? <ResolutionQueue /> : null}
      </div>
    </div>
  );
}
