import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Download, Info, ShieldCheck } from "lucide-react";
import { IconFlask } from "@tabler/icons-react";
import { useMutation, useQuery, useSubscription } from "urql";
import { toast } from "sonner";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { useTenant } from "@/context/TenantContext";
import {
  exportSkillArchive,
  runSkillTrustPipeline,
  skillCatalogClient,
  type SkillTrustReport,
} from "@/lib/workspace-files-api";
import {
  ApplySkillUpdateMutation,
  EvalDatasetsQuery,
  OnEvalRunUpdatedSubscription,
  SkillEvalScoreDetailQuery,
  StartEvalRunMutation,
} from "@/lib/evaluation-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { formatPassRatePct } from "@/lib/skill-eval-format";
import {
  desktopToolbarActiveButtonClassName,
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

// Mirrors packages/api SKILL_DATASET_SLUG_PREFIX / SKILL_CANDIDATE_DATASET_SUFFIX.
// The live skill dataset is `skill-<slug>`; a HELD candidate update stages its
// cases under `skill-<slug>-candidate` (U6) until an operator applies it.
const liveDatasetSlug = (skillSlug: string) => `skill-${skillSlug}`;
const candidateDatasetSlug = (skillSlug: string) =>
  `skill-${skillSlug}-candidate`;

function downloadArchive(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Score + regression + on-demand-run surface for one catalog skill (U9), plus
 * the held-update apply/override surface (U6). Rendered inside the evals side
 * sheet. The whole Skills route is OperatorGuard-wrapped; the mutations
 * re-check requireTenantAdmin server-side.
 */
function SkillEvalSheetContent({ skillSlug }: { skillSlug: string }) {
  const { tenantId } = useTenant();
  const tid = tenantId ?? "";
  const [overrideBlocked, setOverrideBlocked] = useState<{
    passRate: number | null;
    threshold: number | null;
  } | null>(null);

  const [{ data: scoreData, fetching: scoreFetching }, refetchScore] = useQuery(
    {
      query: SkillEvalScoreDetailQuery,
      variables: { tenantId: tid, skillSlug },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    },
  );
  const [{ data: datasetsData }, refetchDatasets] = useQuery({
    query: EvalDatasetsQuery,
    variables: { tenantId: tid, includeArchived: false },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: agentData }] = useQuery({
    query: SettingsTenantAgentQuery,
    variables: { tenantId: tid },
    pause: !tenantId,
  });

  const [{ fetching: starting }, startRun] = useMutation(StartEvalRunMutation);
  const [{ fetching: applying }, applyUpdate] = useMutation(
    ApplySkillUpdateMutation,
  );

  // Live refetch on run-update pings (urql doc cache doesn't auto-invalidate).
  useSubscription(
    {
      query: OnEvalRunUpdatedSubscription,
      variables: { tenantId: tid },
      pause: !tenantId,
    },
    () => {
      refetchScore({ requestPolicy: "network-only" });
      refetchDatasets({ requestPolicy: "network-only" });
      return null;
    },
  );

  const score = scoreData?.skillEvalScore;
  const agentId = agentData?.agent?.id ?? null;
  const candidateSlug = candidateDatasetSlug(skillSlug);
  const heldCandidate = (datasetsData?.evalDatasets ?? []).find(
    (d) => d.slug === candidateSlug && !d.archivedAt,
  );
  // A different (or applied/archived) candidate must not inherit a prior
  // candidate's blocked-override state on this still-mounted page.
  const heldCandidateId = heldCandidate?.id ?? null;
  useEffect(() => {
    setOverrideBlocked(null);
  }, [heldCandidateId]);

  async function runNow() {
    if (!tenantId) return;
    const result = await startRun({
      tenantId,
      input: { datasetSlug: liveDatasetSlug(skillSlug) },
    });
    if (result.error) {
      toast.error(`Could not start the run: ${result.error.message}`);
      return;
    }
    toast.success("Eval run started — the score updates when it completes.");
    refetchScore({ requestPolicy: "network-only" });
  }

  async function apply(override: boolean) {
    if (!tenantId || !agentId) return;
    const result = await applyUpdate({
      tenantId,
      skillSlug,
      agentId,
      override,
    });
    if (result.error) {
      toast.error(`Could not apply the update: ${result.error.message}`);
      return;
    }
    const r = result.data?.applySkillUpdate;
    if (r?.applied) {
      setOverrideBlocked(null);
      toast.success(
        r.overridden
          ? "Update applied (overrode the gate)."
          : "Update applied.",
      );
      refetchScore({ requestPolicy: "network-only" });
      refetchDatasets({ requestPolicy: "network-only" });
      return;
    }
    if (r?.blocked) {
      setOverrideBlocked({
        passRate: r.passRate ?? null,
        threshold: r.threshold ?? null,
      });
    }
  }

  const pct = formatPassRatePct(score?.passRate);
  const scoreLabel = !score
    ? null
    : !score.rated
      ? "Unrated"
      : (pct ?? "Not scored yet");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Eval score
            </span>
            {scoreFetching && !score ? (
              <Spinner className="size-4" />
            ) : (
              <span
                className="text-lg font-semibold tabular-nums"
                data-testid="skill-eval-score"
              >
                {scoreLabel ?? "—"}
              </span>
            )}
            {score?.regression ? (
              <Badge variant="destructive">Regression</Badge>
            ) : null}
          </div>
          {score?.rated ? (
            <span className="text-xs text-muted-foreground">
              {score.totalCases} case{score.totalCases === 1 ? "" : "s"}
              {score.lastRunAt
                ? ` · last run ${new Date(score.lastRunAt).toLocaleString()}`
                : null}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {score?.rated ? (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/settings/evaluations/datasets/$slug"
                params={{ slug: liveDatasetSlug(skillSlug) }}
              >
                View eval dataset
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="skill-run-evals"
            disabled={starting || !score?.rated || score?.evaluable === false}
            onClick={() => void runNow()}
          >
            {starting ? <Spinner className="size-3.5" /> : "Run evals now"}
          </Button>
        </div>
      </div>

      {score && !score.rated ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This skill ships no eval cases yet. Add <code>evals/*.json</code> to
          the skill folder, or flag a thread to it, to start scoring.
        </p>
      ) : null}

      {score && score.evaluable === false ? (
        <p
          className="mt-2 text-xs text-amber-600 dark:text-amber-500"
          data-testid="skill-not-evaluable"
        >
          {score.ineligibleReason ??
            "This skill can't be run in an isolated eval."}{" "}
          Cases can still be flagged here; they'll run once the skill is
          evaluable.
        </p>
      ) : null}

      {heldCandidate ? (
        <div
          className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="skill-held-update"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">Update held.</span>{" "}
              <span className="text-muted-foreground">
                A candidate version is staged pending the update gate.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="/settings/evaluations/datasets/$slug"
                  params={{ slug: candidateSlug }}
                >
                  Review candidate
                </Link>
              </Button>
              {overrideBlocked ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  data-testid="skill-apply-override"
                  disabled={applying || !agentId}
                  onClick={() => void apply(true)}
                >
                  {applying ? <Spinner className="size-3.5" /> : "Apply anyway"}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  data-testid="skill-apply-update"
                  disabled={applying || !agentId}
                  onClick={() => void apply(false)}
                >
                  {applying ? <Spinner className="size-3.5" /> : "Apply update"}
                </Button>
              )}
            </div>
          </div>
          {overrideBlocked ? (
            <p className="mt-1.5 text-xs text-destructive">
              Candidate scored{" "}
              {formatPassRatePct(overrideBlocked.passRate) ?? "no score"}, below
              the {formatPassRatePct(overrideBlocked.threshold) ?? "set"} gate.
              Applying anyway overrides the gate (recorded).
            </p>
          ) : null}
          {!agentId ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              No main agent is available to apply the swap.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SkillInfoSheetContent() {
  return (
    <div className="px-6 pb-6 pt-2 text-sm leading-relaxed text-muted-foreground">
      Catalog edits and imports update the library source only. Installed agent
      copies keep running their pinned version until an operator applies an
      update.
    </div>
  );
}

function SkillTrustSheetContent({
  report,
  running,
  onRun,
}: {
  report: SkillTrustReport | null;
  running: boolean;
  onRun: () => void;
}) {
  const statusVariant =
    report?.status === "blocked" || report?.status === "failed"
      ? "destructive"
      : "secondary";
  const counts = report?.severityCounts;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Pipeline status
            </span>
            {report ? (
              <Badge variant={statusVariant}>{report.status}</Badge>
            ) : null}
          </div>
          {report ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {report.summary}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No trust report has been generated in this session.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="skill-run-trust"
          disabled={running}
          onPointerDown={(event) => {
            if (event.button !== 0 || running) return;
            event.preventDefault();
            onRun();
          }}
          onClick={onRun}
        >
          {running ? <Spinner className="size-3.5" /> : "Run pipeline"}
        </Button>
      </div>

      {report ? (
        <>
          <div className="space-y-1.5 text-sm" data-testid="skill-trust-list">
            <TrustEvidence label="Spec" value={report.spec.status} />
            <TrustEvidence label="SkillSpector" value={report.scanner.status} />
            <TrustEvidence
              label="Skill card"
              value={report.evidence.skillCard}
            />
            <TrustEvidence label="Evals" value={report.evidence.evalDataset} />
            <TrustEvidence
              label="Benchmark"
              value={report.evidence.benchmark}
            />
            <TrustEvidence
              label="Signature"
              value={report.evidence.signature}
            />
          </div>

          <div className="rounded-md border border-border/70 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Severity counts
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-sm tabular-nums">
              {(["critical", "high", "medium", "low", "info"] as const).map(
                (severity) => (
                  <div key={severity}>
                    <div className="font-semibold">
                      {counts?.[severity] ?? 0}
                    </div>
                    <div className="text-[11px] capitalize text-muted-foreground">
                      {severity}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>

          {report.scanner.error ? (
            <p className="text-xs text-destructive">{report.scanner.error}</p>
          ) : null}

          {report.spec.errors.length > 0 ? (
            <div className="rounded-md border border-destructive/40 p-3 text-sm">
              <div className="mb-2 font-medium text-destructive">
                Spec validation
              </div>
              <ul className="space-y-1 text-muted-foreground">
                {report.spec.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.findings.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Findings
              </div>
              {report.findings.map((finding) => (
                <div
                  key={finding.id}
                  className="rounded-md border border-border/70 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{finding.category}</span>
                    <Badge
                      variant={
                        finding.severity === "critical" ||
                        finding.severity === "high"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {finding.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {finding.message}
                  </p>
                  {finding.path ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {finding.path}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <p className="font-mono text-[11px] text-muted-foreground">
            {report.contentHash}
          </p>
        </>
      ) : null}
    </div>
  );
}

function TrustEvidence({ label, value }: { label: string; value: string }) {
  const tone = trustEvidenceTone(value);
  const displayValue = value.replace(/_/g, " ");
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border bg-background/30 px-3 py-2",
        tone.row,
      )}
    >
      <div className="min-w-0 truncate text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <Badge
        variant="outline"
        className={cn(
          "max-w-[58%] shrink-0 justify-center truncate border px-2 py-0.5 text-[11px] font-medium capitalize",
          tone.badge,
        )}
      >
        {displayValue}
      </Badge>
    </div>
  );
}

function trustEvidenceTone(value: string) {
  if (
    value === "passed" ||
    value === "completed" ||
    value === "present" ||
    value === "verified"
  ) {
    return {
      row: "border-emerald-500/35",
      badge:
        "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    };
  }
  if (value === "failed" || value === "blocked") {
    return {
      row: "border-destructive/45",
      badge: "border-destructive/50 bg-destructive/10 text-destructive",
    };
  }
  return {
    row: "border-amber-500/35",
    badge:
      "border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };
}

export function SettingsSkillDetail() {
  const { skillSlug } = useParams({
    from: "/_authed/settings/skills/$skillSlug",
  });
  const [exporting, setExporting] = useState(false);
  const [evalSheetOpen, setEvalSheetOpen] = useState(false);
  const [trustSheetOpen, setTrustSheetOpen] = useState(false);
  const [trustRunning, setTrustRunning] = useState(false);
  const [trustReport, setTrustReport] = useState<SkillTrustReport | null>(null);
  const trustInFlightRef = useRef(false);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);

  async function exportSkill() {
    setExporting(true);
    try {
      const archive = await exportSkillArchive(skillSlug);
      downloadArchive(archive.blob, archive.filename);
      toast.success("Skill archive exported.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown export failure.";
      toast.error(`Could not export the skill: ${message}`);
    } finally {
      setExporting(false);
    }
  }

  async function runTrust() {
    if (trustInFlightRef.current) return;
    trustInFlightRef.current = true;
    setTrustRunning(true);
    try {
      const report = await runSkillTrustPipeline(skillSlug);
      setTrustReport(report);
      toast.success("Skill trust pipeline completed.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown trust pipeline failure.";
      toast.error(`Could not run the trust pipeline: ${message}`);
    } finally {
      trustInFlightRef.current = false;
      setTrustRunning(false);
    }
  }

  // Title + back navigation relocate to the settings header bar: the "Skill
  // Library" crumb links back to the list, and the sidebar's back button also works.
  usePageHeaderActions({
    title: skillSlug,
    breadcrumbs: [
      { label: "Skill Library", href: "/settings/skills" },
      { label: skillSlug },
    ],
    action: (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={
            evalSheetOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          aria-label="Skill evals"
          title="Skill evals"
          onClick={() => setEvalSheetOpen(true)}
        >
          <IconFlask className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={
            trustSheetOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          aria-label="Skill trust"
          title="Skill trust"
          onClick={() => setTrustSheetOpen(true)}
        >
          <ShieldCheck className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={
            infoSheetOpen
              ? desktopToolbarActiveButtonClassName
              : desktopToolbarButtonClassName
          }
          aria-label="Skill info"
          title="Skill info"
          onClick={() => setInfoSheetOpen(true)}
        >
          <Info className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={desktopToolbarButtonClassName}
          aria-label="Export skill archive"
          title="Export skill archive"
          disabled={exporting}
          onClick={() => void exportSkill()}
        >
          {exporting ? (
            <Spinner className="size-4" />
          ) : (
            <Download className="size-4" />
          )}
        </Button>
      </div>
    ),
    actionKey: `skill-actions:${skillSlug}:${exporting ? "exporting" : "idle"}:${evalSheetOpen ? "evals" : "evals-closed"}:${trustSheetOpen ? "trust" : "trust-closed"}:${trustRunning ? "trust-running" : "trust-idle"}:${infoSheetOpen ? "info" : "info-closed"}`,
  });

  return (
    <div className="flex h-full flex-col">
      <Sheet open={evalSheetOpen} onOpenChange={setEvalSheetOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(480px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill evals</SheetTitle>
            <SheetDescription>
              Score, run, and apply held updates for this catalog skill.
            </SheetDescription>
          </SheetHeader>
          <SkillEvalSheetContent skillSlug={skillSlug} />
        </SheetContent>
      </Sheet>
      <Sheet open={infoSheetOpen} onOpenChange={setInfoSheetOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(480px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill info</SheetTitle>
            <SheetDescription>Catalog source behavior</SheetDescription>
          </SheetHeader>
          <SkillInfoSheetContent />
        </SheetContent>
      </Sheet>
      <Sheet open={trustSheetOpen} onOpenChange={setTrustSheetOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill trust</SheetTitle>
            <SheetDescription>
              SkillSpector scan, release evidence, and signature status.
            </SheetDescription>
          </SheetHeader>
          <SkillTrustSheetContent
            report={trustReport}
            running={trustRunning}
            onRun={() => void runTrust()}
          />
        </SheetContent>
      </Sheet>
      <div className="min-h-0 flex-1">
        <WorkspaceFileEditor
          target={{ skill: skillSlug }}
          targetKey={`skill:${skillSlug}`}
          client={skillCatalogClient}
          defaultOpenFile="SKILL.md"
          bordered={false}
          className="h-full"
          loadingSlot={<LoadingShimmer />}
        />
      </div>
    </div>
  );
}
