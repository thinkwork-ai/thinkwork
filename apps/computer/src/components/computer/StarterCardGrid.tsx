import {
  BarChart3,
  BriefcaseBusiness,
  FileSpreadsheet,
  LineChart,
  Network,
  Presentation,
} from "lucide-react";
import { Button } from "@thinkwork/ui";

export interface StarterCard {
  id: string;
  title: string;
  description: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const DEFAULT_STARTER_CARDS: StarterCard[] = [
  {
    id: "crm-pipeline-risk",
    title: "CRM pipeline risk",
    description: "Find stale late-stage opportunities and revenue exposure.",
    prompt:
      "Build a CRM pipeline risk dashboard for LastMile opportunities, including stale activity, stage exposure, and the top risks to review.",
    icon: BarChart3,
  },
  {
    id: "account-research",
    title: "Account research brief",
    description: "Collect recent signals for a target account.",
    prompt:
      "Prepare an account research brief with recent company signals, open opportunities, and next best actions.",
    icon: BriefcaseBusiness,
  },
  {
    id: "board-summary",
    title: "Board-ready summary",
    description: "Turn working notes into an executive update.",
    prompt:
      "Create a board-ready summary of the current pipeline, risks, and decisions needed this week.",
    icon: Presentation,
  },
  {
    id: "spreadsheet-analysis",
    title: "Spreadsheet analysis",
    description: "Inspect uploaded tabular data for anomalies.",
    prompt:
      "Analyze a spreadsheet for trends, anomalies, and recommended follow-up questions.",
    icon: FileSpreadsheet,
  },
  {
    id: "connect-business-apps",
    title: "Connect business apps",
    description: "Review what data sources are available for this Computer.",
    prompt:
      "Show me which business apps are connected and what kinds of work you can do with them.",
    icon: Network,
  },
  {
    id: "data-visualization",
    title: "Data visualization",
    description: "Turn a business question into a dashboard plan.",
    prompt:
      "Create a concise data visualization plan for the business question I am trying to answer.",
    icon: LineChart,
  },
];

interface StarterCardGridProps {
  cards?: StarterCard[];
  onSelect: (prompt: string) => void;
}

export function StarterCardGrid({
  cards = DEFAULT_STARTER_CARDS,
  onSelect,
}: StarterCardGridProps) {
  return (
    <section aria-labelledby="starter-card-heading" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="starter-card-heading"
          className="text-sm font-medium text-muted-foreground"
        >
          Start with
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Button
            key={card.id}
            type="button"
            variant="outline"
            className="h-auto min-h-28 justify-start rounded-lg border-border/70 bg-background/40 p-4 text-left transition-colors hover:bg-accent/40"
            onClick={() => onSelect(card.prompt)}
          >
            <span className="flex min-w-0 flex-col gap-3">
              <span className="flex items-center gap-2">
                <card.icon className="size-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium text-foreground">
                  {card.title}
                </span>
              </span>
              <span className="whitespace-normal text-xs leading-5 text-muted-foreground">
                {card.description}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}
