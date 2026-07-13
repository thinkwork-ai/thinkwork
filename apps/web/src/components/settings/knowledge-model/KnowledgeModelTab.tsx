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

const VIEW_OPTIONS: ReadonlyArray<{
  value: KnowledgeModelView;
  label: string;
}> = [
  { value: "definitions", label: "Definitions" },
  { value: "identity", label: "Identity" },
  { value: "resolution-queue", label: "Resolution Queue" },
];

/**
 * Ontology tab of the unified Memory page (THINK-193 U4). The active
 * sub-view's title is also the view selector, keeping the page hierarchy clear
 * while preserving three content-only views: term Definitions (the
 * pre-existing knowledge-graph tab content), the canonical-entity Identity
 * list, and the entity Resolution Queue. Selection is component-local state so
 * the existing /settings/memory/ontology route keeps working unchanged.
 */
export function KnowledgeModelTab() {
  const [view, setView] = useState<KnowledgeModelView>("definitions");
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
        {view === "definitions" ? <KnowledgeGraphTab /> : null}
        {view === "identity" ? <IdentityList /> : null}
        {view === "resolution-queue" ? <ResolutionQueue /> : null}
      </div>
    </div>
  );
}
