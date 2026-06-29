import { Badge } from "@thinkwork/ui";

import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";

export function ValueAlignmentTool({
  account,
  opportunity,
}: {
  account: EngagementAccount | null;
  opportunity: EngagementOpportunityWithLayers | null;
}) {
  return (
    <section className="max-w-5xl space-y-4">
      <div className="rounded-md border border-border bg-card p-5">
        <Badge variant="secondary">Engagement Step 1 of 4</Badge>
        <h3 className="mt-3 text-lg font-semibold text-foreground">
          Value Discovery & Alignment Session
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Align the executive sponsor around the business outcome, the visible
          pain, and the discovery areas worth deeper validation.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <BriefCard
          title="Strategic pain"
          body="Identify the business driver, urgency, and cost of inaction in the sponsor's language."
        />
        <BriefCard
          title="Discovery audience"
          body="Confirm the departments, system owners, and decision makers needed for the kickoff."
        />
        <BriefCard
          title="Next step"
          body="Leave with a concrete Discovery Kickoff agenda and the 2-3 priority areas to inspect."
        />
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-4 text-sm">
        <div className="font-semibold text-foreground">Current context</div>
        <p className="mt-1 text-muted-foreground">
          {account?.company.name ?? "No account selected"}{" "}
          {opportunity ? `- ${opportunity.opportunity.name}` : ""}
        </p>
      </div>
    </section>
  );
}

function BriefCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}
