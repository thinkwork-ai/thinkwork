import { Badge } from "@thinkwork/ui";

import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";

export function PreSessionBrief({
  account,
  opportunity,
}: {
  account: EngagementAccount | null;
  opportunity: EngagementOpportunityWithLayers | null;
}) {
  return (
    <section className="max-w-5xl space-y-4">
      <div className="rounded-md border border-border bg-card p-5">
        <Badge variant="secondary">Engagement Step 2 of 4</Badge>
        <h3 className="mt-3 text-lg font-semibold text-foreground">
          AI Discovery Session: What to Expect
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Prepare stakeholders for a structured working session that captures
          current-state friction, KPI targets, and open questions.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <BriefCard
          title="Bring the right people"
          body="Executive sponsor, data owner, department leads, and anyone who owns the current workflow."
        />
        <BriefCard
          title="Agree on outcomes"
          body="The session should produce baseline metrics, use-case scope, ownership, and the open-question list."
        />
        <BriefCard
          title="No formal prep"
          body="Participants can show up with examples, reports, and pain points instead of polished documentation."
        />
        <BriefCard
          title="ThinkWork capture"
          body="Notes feed the Discovery & KPI Tracker so the team can report progress at 30/60/90 days."
        />
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-4 text-sm">
        <div className="font-semibold text-foreground">Session target</div>
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
