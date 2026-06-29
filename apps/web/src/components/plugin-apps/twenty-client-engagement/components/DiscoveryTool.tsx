import { useEffect, useState } from "react";
import { Button, Input, Textarea } from "@thinkwork/ui";

import type {
  EngagementAccount,
  EngagementOpportunityWithLayers,
} from "../data/useTwentyEngagementData";

export function DiscoveryTool({
  account,
  opportunity,
  overlayBySection,
  onSaveOverlay,
  onOpenGuide,
}: {
  account: EngagementAccount | null;
  opportunity: EngagementOpportunityWithLayers | null;
  overlayBySection: Map<string, Record<string, unknown>>;
  onSaveOverlay: (
    opportunityId: string,
    sectionKey: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  onOpenGuide: () => void;
}) {
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState("");
  const [checkIns, setCheckIns] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseline(stringField(overlayBySection.get("kpi-framework"), "baseline"));
    setTarget(stringField(overlayBySection.get("kpi-framework"), "target"));
    setScope(stringField(overlayBySection.get("use-case-scope"), "scope"));
    setCheckIns(stringField(overlayBySection.get("check-ins"), "summary"));
  }, [overlayBySection]);

  if (!opportunity) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <h3 className="text-sm font-semibold text-foreground">
          Select an opportunity
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Open an opportunity before using the Discovery & KPI Tracker.
        </p>
      </div>
    );
  }
  const opportunityId = opportunity.opportunity.id;

  async function save(sectionKey: string, payload: Record<string, unknown>) {
    setSaving(sectionKey);
    setError(null);
    try {
      await onSaveOverlay(opportunityId, sectionKey, payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Engagement Step 4 of 4
          </p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">
            Client Discovery & KPI Tracker
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {account?.company.name} - {opportunity.opportunity.name}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenGuide}>
          Discovery guide
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground">
            KPI Framework
          </h4>
          <div className="mt-4 grid gap-3">
            <Input
              aria-label="Discovery KPI baseline"
              value={baseline}
              onChange={(event) => setBaseline(event.target.value)}
              placeholder="Baseline, e.g. 8 hours/week"
            />
            <Input
              aria-label="Discovery KPI target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="Target, e.g. under 5 minutes"
            />
            <Button
              type="button"
              size="sm"
              onClick={() =>
                save("kpi-framework", {
                  baseline,
                  target,
                })
              }
              disabled={saving === "kpi-framework"}
            >
              {saving === "kpi-framework" ? "Saving..." : "Save KPIs"}
            </Button>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground">
            Use Case Scope
          </h4>
          <Textarea
            aria-label="Discovery use case scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className="mt-4 min-h-28"
            placeholder="3-5 use cases, UAT testers, and production acceptance criteria."
          />
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => save("use-case-scope", { scope })}
            disabled={saving === "use-case-scope"}
          >
            {saving === "use-case-scope" ? "Saving..." : "Save scope"}
          </Button>
        </section>
      </div>

      <section className="rounded-md border border-border bg-card p-4">
        <h4 className="text-sm font-semibold text-foreground">
          30/60/90 Check-ins
        </h4>
        <Textarea
          aria-label="Discovery check-ins"
          value={checkIns}
          onChange={(event) => setCheckIns(event.target.value)}
          className="mt-4 min-h-28"
          placeholder="Capture check-in rhythm, current outcomes, actual KPI movement, and follow-up actions."
        />
        <Button
          type="button"
          size="sm"
          className="mt-3"
          onClick={() => save("check-ins", { summary: checkIns })}
          disabled={saving === "check-ins"}
        >
          {saving === "check-ins" ? "Saving..." : "Save check-ins"}
        </Button>
      </section>
    </section>
  );
}

function stringField(
  payload: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}
