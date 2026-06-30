export function DiscoveryGuide() {
  return (
    <section className="max-w-5xl space-y-4">
      <div className="rounded-md border border-border bg-card p-5">
        <h3 className="text-lg font-semibold text-foreground">
          How to Use the Discovery & KPI Tracker
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Use the tracker as a notes system for a structured conversation, not
          as a script. Capture baseline facts, decision-maker context, KPIs, and
          the first use-case scope while the conversation is fresh.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <GuideCard
          title="Before the session"
          body="Scan stakeholders, target use cases, action items, and KPI candidates so corrections can happen live."
        />
        <GuideCard
          title="During discovery"
          body="Anchor on current-state friction first, then quantify the business impact and what success looks like."
        />
        <GuideCard
          title="After discovery"
          body="Convert notes into KPI baselines, scope decisions, and check-in updates rather than leaving them as raw transcript."
        />
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-4">
        <h4 className="text-sm font-semibold text-foreground">
          Questions to ask
        </h4>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
          <p>
            What process is slow, expensive, or too dependent on one person?
          </p>
          <p>How often does the team ask for this data or decision support?</p>
          <p>Which KPI would make the sponsor call this engagement a win?</p>
          <p>What must be true before the team signs off on production use?</p>
        </div>
      </div>
    </section>
  );
}

function GuideCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}
