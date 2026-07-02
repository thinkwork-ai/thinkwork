import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useClient, useQuery } from "urql";
import { AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardContent, Label } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import {
  EvalDatasetsQuery,
  EvalProfilesQuery,
  EvalRunQuery,
  EvalRunsQuery,
} from "@/lib/evaluation-queries";
import { shortModelLabel } from "@/components/settings/SettingsEvalProfiles";
import { cn, relativeTime } from "@/lib/utils";

type CompareRun = {
  id: string;
  status: string;
  profileId: string | null;
  profileName: string | null;
  datasetId: string | null;
  datasetVersion: number | null;
  scoringVersion: number | null;
  completedAt: string | null;
  createdAt: string;
};

type RunDetail = {
  id: string;
  status: string;
  passed: number;
  failed: number;
  errored: number | null;
  unstable: number | null;
  totalTests: number;
  passRate: number | null;
  costUsd: number | null;
  costPartial: boolean;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  datasetVersion: number | null;
  scoringVersion: number | null;
  profileSnapshot: string | null;
  completedAt: string | null;
};

export type ProfileSnapshotFields = {
  judgeModel: string | null;
  workspaceFingerprint: string[] | null;
};

export function parseProfileSnapshot(
  raw: string | null | undefined,
): ProfileSnapshotFields {
  if (!raw) return { judgeModel: null, workspaceFingerprint: null };
  try {
    const parsed = JSON.parse(raw) as {
      judgeModel?: unknown;
      workspaceFingerprint?: unknown;
    };
    return {
      judgeModel:
        typeof parsed.judgeModel === "string" ? parsed.judgeModel : null,
      workspaceFingerprint: Array.isArray(parsed.workspaceFingerprint)
        ? parsed.workspaceFingerprint.map(String)
        : null,
    };
  } catch {
    return { judgeModel: null, workspaceFingerprint: null };
  }
}

/**
 * Comparability gate (KTD6): runs compare cleanly only under the same
 * dataset version + scoring version + judge pin. Drift renders flagged,
 * not silently compared; partial (running/cancelled) runs and
 * fingerprint drift get their own flags.
 */
export function comparabilityFlags(
  details: Array<
    Pick<
      RunDetail,
      "datasetVersion" | "scoringVersion" | "status" | "profileSnapshot"
    >
  >,
): string[] {
  const flags: string[] = [];
  if (details.length < 2) return flags;
  const datasetVersions = new Set(
    details.map((d) => d.datasetVersion ?? "none"),
  );
  if (datasetVersions.size > 1) {
    flags.push(
      "Dataset versions differ — the runs scored different case sets.",
    );
  }
  const scoringVersions = new Set(
    details.map((d) => d.scoringVersion ?? "legacy"),
  );
  if (scoringVersions.size > 1) {
    flags.push("Scoring versions differ — pass rates are on different scales.");
  }
  const judges = new Set(
    details.map(
      (d) => parseProfileSnapshot(d.profileSnapshot).judgeModel ?? "default",
    ),
  );
  if (judges.size > 1) {
    flags.push(
      "Judge pins differ — rubric verdicts came from different judges.",
    );
  }
  const fingerprints = new Set(
    details.map((d) => {
      const fp = parseProfileSnapshot(d.profileSnapshot).workspaceFingerprint;
      return fp ? fp.join(",") : "unrecorded";
    }),
  );
  if (fingerprints.size > 1) {
    flags.push(
      "Workspace fingerprints differ — the agents under test had different skills enabled.",
    );
  }
  if (details.some((d) => d.status !== "completed")) {
    flags.push("Includes a partial (running or cancelled) run.");
  }
  return flags;
}

export function SettingsEvalCompare() {
  const { tenantId } = useTenant();
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);

  const [profilesResult] = useQuery({
    query: EvalProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [datasetsResult] = useQuery({
    query: EvalDatasetsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [runsResult] = useQuery({
    query: EvalRunsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100, offset: 0 },
    pause: !tenantId,
  });

  usePageHeaderActions({
    title: "Compare Profiles",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Compare" },
    ],
    actionKey: `eval-compare:${tenantId ?? ""}`,
  });

  const runs = (runsResult.data?.evalRuns?.items ??
    []) as unknown as CompareRun[];

  // Latest completed run per selected profile on the selected dataset —
  // query-time selection only (KTD6), never new finalization math.
  const latestRunByProfile = useMemo(() => {
    const map = new Map<string, CompareRun>();
    for (const run of runs) {
      if (run.status !== "completed") continue;
      if (!run.profileId) continue;
      if (datasetId && run.datasetId !== datasetId) continue;
      if (!datasetId && run.datasetId) continue;
      const existing = map.get(run.profileId);
      const runAt = run.completedAt ?? run.createdAt;
      const existingAt = existing?.completedAt ?? existing?.createdAt;
      if (!existing || (runAt && existingAt && runAt > existingAt)) {
        map.set(run.profileId, run);
      }
    }
    return map;
  }, [runs, datasetId]);

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  const profiles = (profilesResult.data?.evalProfiles ?? []) as Array<{
    id: string;
    name: string;
    model: string;
    isDefault: boolean;
  }>;
  const datasets = (datasetsResult.data?.evalDatasets ?? []) as Array<{
    id: string;
    slug: string;
    name: string | null;
    version: number;
  }>;
  const loading =
    profilesResult.fetching || datasetsResult.fetching || runsResult.fetching;

  function toggleProfile(id: string) {
    setSelectedProfileIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsPageTitle
        title="Compare Profiles"
        description="Side-by-side latest completed run per profile on one dataset — verdict counts, cost per case, and latency percentiles, with comparability flags when versions or judges drift."
      />
      {loading ? (
        <LoadingShimmer />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-2">
            <Label>Dataset</Label>
            <div className="flex flex-wrap gap-2">
              <CompareChip
                selected={datasetId === null}
                onClick={() => setDatasetId(null)}
              >
                Category runs (no dataset)
              </CompareChip>
              {datasets.map((dataset) => (
                <CompareChip
                  key={dataset.id}
                  selected={datasetId === dataset.id}
                  onClick={() => setDatasetId(dataset.id)}
                >
                  {dataset.name ?? dataset.slug}
                  <span className="ml-1 text-xs opacity-70">
                    v{dataset.version}
                  </span>
                </CompareChip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Profiles</Label>
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No profiles yet —{" "}
                <Link
                  to="/settings/evaluations/profiles"
                  className="underline underline-offset-2"
                >
                  create one
                </Link>{" "}
                to compare.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {profiles.map((profile) => (
                  <CompareChip
                    key={profile.id}
                    selected={selectedProfileIds.includes(profile.id)}
                    onClick={() => toggleProfile(profile.id)}
                  >
                    {profile.name}
                    <span className="ml-1 text-xs opacity-70">
                      {shortModelLabel(profile.model)}
                    </span>
                  </CompareChip>
                ))}
              </div>
            )}
          </div>

          {selectedProfileIds.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Select two or more profiles to compare their latest completed
                runs.
              </CardContent>
            </Card>
          ) : selectedProfileIds.length === 1 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                One profile selected — pick at least one more to build the
                comparison matrix.
              </CardContent>
            </Card>
          ) : (
            <ComparisonMatrix
              profiles={profiles.filter((p) =>
                selectedProfileIds.includes(p.id),
              )}
              latestRunByProfile={latestRunByProfile}
            />
          )}
        </div>
      )}
    </SettingsPane>
  );
}

function ComparisonMatrix({
  profiles,
  latestRunByProfile,
}: {
  profiles: Array<{ id: string; name: string; model: string }>;
  latestRunByProfile: Map<string, CompareRun>;
}) {
  return (
    <div className="space-y-3">
      <ComparabilityBanner
        runIds={profiles
          .map((p) => latestRunByProfile.get(p.id)?.id)
          .filter((id): id is string => Boolean(id))}
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {profiles.map((profile) => {
          const run = latestRunByProfile.get(profile.id);
          return (
            <Card key={profile.id}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{profile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {shortModelLabel(profile.model)}
                  </span>
                </div>
                {run ? (
                  <ProfileRunStats runId={run.id} />
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No completed runs for this profile on the selected dataset
                    yet — launch one from the Evaluations page.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Comparability flags need every chosen run's detail (snapshot, versions).
 * Details are fetched imperatively (one hook, variable id count — a
 * per-id useQuery would change the hook count as selection changes);
 * urql's cache dedupes these with the per-card fetches below.
 */
function ComparabilityBanner({ runIds }: { runIds: string[] }) {
  const client = useClient();
  const [details, setDetails] = useState<RunDetail[]>([]);

  useEffect(() => {
    if (runIds.length < 2) {
      setDetails([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      runIds.map((id) => client.query(EvalRunQuery, { id }).toPromise()),
    ).then((results) => {
      if (cancelled) return;
      setDetails(
        results
          .map((r) => r.data?.evalRun as unknown as RunDetail | undefined)
          .filter((r): r is RunDetail => r != null),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runIds.join(",")]);

  if (details.length < 2) return null;
  const flags = comparabilityFlags(details);
  if (flags.length === 0) return null;
  return (
    <Card className="border-amber-500/50">
      <CardContent className="flex flex-col gap-1 pt-4 text-sm">
        <span className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Not directly comparable
        </span>
        {flags.map((flag) => (
          <span key={flag} className="text-muted-foreground">
            {flag}
          </span>
        ))}
      </CardContent>
    </Card>
  );
}

function useRunDetail(runId: string): RunDetail | null {
  const [result] = useQuery({
    query: EvalRunQuery,
    variables: { id: runId },
  });
  return (result.data?.evalRun as unknown as RunDetail | undefined) ?? null;
}

function ProfileRunStats({ runId }: { runId: string }) {
  const run = useRunDetail(runId);
  if (!run) return <LoadingShimmer />;
  const costPerCase =
    run.costUsd != null && run.totalTests > 0
      ? run.costUsd / run.totalTests
      : null;
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-4 gap-1 text-center">
        <VerdictStat label="Pass" value={run.passed} tone="text-green-500" />
        <VerdictStat label="Fail" value={run.failed} tone="text-red-500" />
        <VerdictStat
          label="Error"
          value={run.errored ?? 0}
          tone="text-amber-500"
        />
        <VerdictStat
          label="Unstable"
          value={run.unstable ?? 0}
          tone="text-purple-500"
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Pass rate</span>
        <span className="tabular-nums font-medium text-foreground">
          {run.passRate != null
            ? `${(run.passRate * 100).toFixed(1)}%`
            : "No score"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Cost / case</span>
        <span className="tabular-nums">
          {costPerCase != null ? `$${costPerCase.toFixed(4)}` : "—"}
          {run.costPartial && (
            <Badge
              variant="outline"
              className="ml-1 text-[10px] text-amber-600 dark:text-amber-400"
              title="Some result rows are missing priced agent-turn cost — the total understates real spend."
            >
              partial
            </Badge>
          )}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Latency p50 / p95</span>
        <span className="tabular-nums">
          {run.latencyP50Ms != null ? `${run.latencyP50Ms}ms` : "—"} /{" "}
          {run.latencyP95Ms != null ? `${run.latencyP95Ms}ms` : "—"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Completed</span>
        <span>{run.completedAt ? relativeTime(run.completedAt) : "—"}</span>
      </div>
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to="/settings/evaluations/$runId" params={{ runId }}>
          Open run
        </Link>
      </Button>
    </div>
  );
}

function VerdictStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-md border px-1 py-1.5">
      <div className={cn("text-base font-semibold tabular-nums", tone)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function CompareChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        selected
          ? "bg-foreground text-background border-foreground"
          : "bg-transparent text-foreground border-border hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
