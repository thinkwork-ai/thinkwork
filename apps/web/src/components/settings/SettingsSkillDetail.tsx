import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Download,
  FileText,
  Info,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
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
import { Response } from "@/components/ai-elements/response";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { useTenant } from "@/context/TenantContext";
import {
  exportSkillArchive,
  fixSkillTrustEvidence,
  getSkillTrustReport,
  runSkillTrustPipeline,
  skillCatalogClient,
  spacesWorkspaceFilesClient,
  type SkillTrustEvidenceFixStepId,
  type SkillTrustEvidenceFixResult,
  type SkillTrustReport,
} from "@/lib/workspace-files-api";
import {
  ApplySkillUpdateMutation,
  EvalDatasetsQuery,
  OnEvalRunUpdatedSubscription,
  SkillEvalScoreDetailQuery,
  StartEvalRunMutation,
} from "@/lib/evaluation-queries";
import {
  PublishSkillDraftMutation,
  SettingsSkillDraftsQuery,
} from "@/lib/skill-creator-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { ApiError } from "@/lib/api-fetch";
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
const SKILL_TRUST_SHEET_WIDTH_CLASS = "data-[side=right]:max-w-none";
const SKILL_TRUST_SHEET_STYLE: CSSProperties = {
  width: "min(520px, calc(100vw - 2rem))",
  maxWidth: "none",
};

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

function SkillCardSheetContent({
  content,
  sha256,
}: {
  content: string;
  sha256: string | null;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <article>
        <div data-testid="skill-card-markdown">
          <Response className="prose-invert text-sm leading-relaxed text-foreground prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold prose-p:my-3 prose-p:leading-6 prose-ul:my-2 prose-li:my-0 prose-blockquote:my-4 prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none [&_h1]:text-xl [&_h2]:text-base [&_h3]:text-sm [&_li>p]:my-0">
            {content.trim()}
          </Response>
        </div>
      </article>
      {sha256 ? (
        <p className="mt-4 break-all font-mono text-[11px] text-muted-foreground">
          {sha256}
        </p>
      ) : null}
    </div>
  );
}

function SkillTrustSheetContent({
  skillSlug,
  report,
  running,
  loadingCached,
  cacheStale,
  fixingStep,
  fixWarning,
  requestedStepId,
  onRun,
  onFix,
  onRequestedStepHandled,
}: {
  skillSlug: string;
  report: SkillTrustReport | null;
  running: boolean;
  loadingCached: boolean;
  cacheStale: boolean;
  fixingStep: SkillTrustEvidenceFixStepId | null;
  fixWarning: string | null;
  requestedStepId?: SkillTrustStepId | null;
  onRun: () => void;
  onFix: (step: SkillTrustEvidenceFixStepId) => void;
  onRequestedStepHandled?: () => void;
}) {
  const [selectedStepId, setSelectedStepId] = useState<SkillTrustStepId | null>(
    null,
  );
  const statusVariant =
    report?.status === "blocked" || report?.status === "failed"
      ? "destructive"
      : "secondary";
  const counts = report?.severityCounts;
  const steps = report ? buildSkillTrustSteps(report) : [];
  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? null;

  useEffect(() => {
    if (!report) {
      setSelectedStepId(null);
      return;
    }
    setSelectedStepId((current) =>
      current && steps.some((step) => step.id === current) ? current : null,
    );
  }, [report?.contentHash]);

  useEffect(() => {
    if (!report || !requestedStepId) return;
    if (!steps.some((step) => step.id === requestedStepId)) return;
    setSelectedStepId(requestedStepId);
    onRequestedStepHandled?.();
  }, [requestedStepId, report?.contentHash]);

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
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.summary}
              </p>
              {cacheStale ? (
                <p className="mt-1 text-xs text-amber-400">
                  Cached report is stale. Run the pipeline to refresh it for the
                  current skill contents.
                </p>
              ) : null}
            </>
          ) : loadingCached ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Loading cached trust report...
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No cached trust report has been generated yet.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="skill-run-trust"
          disabled={running}
          onClick={onRun}
        >
          {running ? <Spinner className="size-3.5" /> : "Run pipeline"}
        </Button>
      </div>

      {report ? (
        <>
          <div className="space-y-1.5 text-sm" data-testid="skill-trust-list">
            {steps.map((step) => (
              <TrustEvidenceRow
                key={step.id}
                step={step}
                selected={step.id === selectedStep?.id}
                fixing={fixingStep === step.id}
                onSelect={() => setSelectedStepId(step.id)}
              />
            ))}
          </div>

          <Sheet
            open={Boolean(selectedStep)}
            onOpenChange={(open) => {
              if (!open) setSelectedStepId(null);
            }}
          >
            <SheetContent
              className={cn(
                "flex w-full flex-col gap-0 overflow-y-auto",
                SKILL_TRUST_SHEET_WIDTH_CLASS,
              )}
              style={SKILL_TRUST_SHEET_STYLE}
            >
              <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
                <SheetTitle>{selectedStep?.label ?? "Trust step"}</SheetTitle>
                <SheetDescription>
                  Purpose, current evidence state, and available fix action.
                </SheetDescription>
              </SheetHeader>
              {selectedStep ? (
                <TrustStepDetail
                  skillSlug={skillSlug}
                  step={selectedStep}
                  contentHash={report.contentHash}
                  fixing={fixingStep === selectedStep.id}
                  running={running}
                  fixWarning={fixWarning}
                  onRun={onRun}
                  onFix={onFix}
                />
              ) : null}
            </SheetContent>
          </Sheet>

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

type SkillTrustStepId = "spec" | "scanner" | SkillTrustEvidenceFixStepId;

type SkillTrustStep = {
  id: SkillTrustStepId;
  label: string;
  status: string;
  purpose: string;
  currentState: string;
  details?: Array<{ label: string; value: string; monospace?: boolean }>;
  findings?: SkillTrustReport["findings"];
  artifactPath?: string;
  fixStep?: SkillTrustEvidenceFixStepId;
  fixLabel?: string;
  disabledReason?: string;
  runLabel?: string;
};

function TrustEvidenceRow({
  step,
  selected,
  fixing,
  onSelect,
}: {
  step: SkillTrustStep;
  selected: boolean;
  fixing: boolean;
  onSelect: () => void;
}) {
  const tone = trustEvidenceTone(step.status);
  const displayValue = displayTrustStatus(step.status);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${step.label} trust step: ${displayValue}`}
      data-testid={`skill-trust-step-${step.id}`}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background/30 px-3 py-2 text-left transition hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring",
        tone.row,
        selected && "bg-muted/40",
      )}
      onClick={onSelect}
    >
      <div className="min-w-0 truncate text-xs uppercase tracking-wide text-muted-foreground">
        {step.label}
      </div>
      <Badge
        variant="outline"
        className={cn(
          "max-w-[58%] shrink-0 justify-center truncate border px-2 py-0.5 text-[11px] font-medium capitalize",
          tone.badge,
        )}
      >
        {fixing ? "Generating" : displayValue}
      </Badge>
    </button>
  );
}

function TrustStepDetail({
  skillSlug,
  step,
  contentHash,
  fixing,
  running,
  fixWarning,
  onRun,
  onFix,
}: {
  skillSlug: string;
  step: SkillTrustStep;
  contentHash: string;
  fixing: boolean;
  running: boolean;
  fixWarning: string | null;
  onRun: () => void;
  onFix: (step: SkillTrustEvidenceFixStepId) => void;
}) {
  const canFix = Boolean(step.fixStep && !step.disabledReason);
  const canRun = step.id === "scanner";
  return (
    <section className="px-6 pb-6 pt-4" data-testid="skill-trust-step-detail">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">{step.purpose}</p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 border px-2 py-0.5 text-[11px] font-medium capitalize",
            trustEvidenceTone(step.status).badge,
          )}
        >
          {displayTrustStatus(step.status)}
        </Badge>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <TrustDetailRow label="Skill" value={skillSlug} />
        <TrustDetailRow label="Current state" value={step.currentState} />
        <TrustDetailRow
          label="Artifact"
          value={step.artifactPath ?? "No artifact detected"}
        />
        <TrustDetailRow label="Content hash" value={contentHash} monospace />
        {step.details?.map((detail) => (
          <TrustDetailRow
            key={detail.label}
            label={detail.label}
            value={detail.value}
            monospace={detail.monospace}
          />
        ))}
      </div>

      {step.findings ? (
        <div className="mt-5 rounded-md border border-border/70 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            SkillSpector output
          </div>
          {step.findings.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {step.findings.map((finding) => (
                <li key={finding.id} className="rounded-md bg-muted/25 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {finding.severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {finding.category}
                    </span>
                    {finding.path ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {finding.path}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{finding.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No SkillSpector findings were returned for this run.
            </p>
          )}
        </div>
      ) : null}

      {step.disabledReason ? (
        <p className="mt-4 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {step.disabledReason}
        </p>
      ) : null}

      {fixWarning ? (
        <p className="mt-4 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {fixWarning}
        </p>
      ) : null}

      {step.fixStep ? (
        <Button
          type="button"
          size="sm"
          className="mt-4"
          data-testid="skill-trust-fix-step"
          disabled={!canFix || fixing}
          onClick={() => onFix(step.fixStep!)}
        >
          {fixing ? (
            <Spinner className="size-3.5" />
          ) : (
            (step.fixLabel ?? "Generate missing component")
          )}
        </Button>
      ) : null}

      {canRun ? (
        <Button
          type="button"
          size="sm"
          className="mt-4"
          data-testid="skill-trust-run-scanner"
          disabled={running}
          onClick={onRun}
        >
          {running ? (
            <Spinner className="size-3.5" />
          ) : (
            (step.runLabel ?? "Run scan")
          )}
        </Button>
      ) : null}
    </section>
  );
}

function TrustDetailRow({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "break-words text-sm",
          monospace && "font-mono text-xs text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function buildSkillTrustSteps(report: SkillTrustReport): SkillTrustStep[] {
  const fixedSteps: SkillTrustStep[] = [
    {
      id: "skillCard",
      label: "Skill card",
      status: report.evidence.skillCard,
      purpose:
        "Documents what the skill does, who owns it, intended use, declared tools, and review notes for operators.",
      currentState: releaseEvidenceState(report.evidence.skillCard),
      artifactPath: report.artifactPaths.skillCard,
      fixStep:
        report.evidence.skillCard === "missing" ? "skillCard" : undefined,
      fixLabel: "Generate missing component",
    },
    {
      id: "evalDataset",
      label: "Evals",
      status: report.evidence.evalDataset,
      purpose:
        "Provides starter cases that exercise the skill behavior before operators rely on it in production.",
      currentState: releaseEvidenceState(report.evidence.evalDataset),
      artifactPath: report.artifactPaths.evals[0],
      fixStep:
        report.evidence.evalDataset === "missing" ? "evalDataset" : undefined,
      fixLabel: "Generate missing component",
    },
    {
      id: "benchmark",
      label: "Benchmark",
      status: report.evidence.benchmark,
      purpose:
        "Records benchmark readiness and measurement expectations without inventing unmeasured pass rates.",
      currentState: releaseEvidenceState(report.evidence.benchmark),
      artifactPath: report.artifactPaths.benchmark,
      fixStep:
        report.evidence.benchmark === "missing" ? "benchmark" : undefined,
      fixLabel: "Generate missing component",
    },
    {
      id: "signature",
      label: "Signature",
      status: report.evidence.signature,
      purpose:
        "Verifies the catalog contents were signed as release evidence after review and scanning.",
      currentState: signatureEvidenceState(report.evidence.signature),
      artifactPath: report.artifactPaths.signature,
      fixStep:
        report.evidence.signature === "missing" ||
        report.evidence.signature === "missing_signing_config" ||
        report.evidence.signature === "present_unverified" ||
        report.evidence.signature === "stale" ||
        report.evidence.signature === "invalid"
          ? "signature"
          : undefined,
      fixLabel: "Approve and sign",
    },
  ];
  return [
    {
      id: "spec",
      label: "Spec",
      status: report.spec.status,
      purpose:
        "Validates SKILL.md frontmatter, required metadata, and the catalog slug contract.",
      currentState:
        report.spec.status === "passed"
          ? "SKILL.md satisfies the required skill specification checks."
          : report.spec.errors.join(" ") ||
            "SKILL.md does not satisfy the required skill specification checks.",
    },
    {
      id: "scanner",
      label: "SkillSpector",
      status: report.scanner.status,
      purpose:
        "Runs the NVIDIA SkillSpector scan and normalizes risk findings into the trust report.",
      currentState:
        report.scanner.status === "completed"
          ? "SkillSpector completed for this catalog snapshot."
          : report.scanner.status === "not_configured"
            ? "SkillSpector is not configured for this environment."
            : (report.scanner.error ??
              "SkillSpector did not complete successfully for this catalog snapshot."),
      details: skillSpectorDetails(report),
      findings: report.findings,
      runLabel: "Run SkillSpector scan",
    },
    ...fixedSteps
      .slice()
      .sort(
        (a, b) =>
          Number(isTrustStepSatisfied(a)) - Number(isTrustStepSatisfied(b)),
      ),
  ];
}

function firstActionableTrustStep(steps: SkillTrustStep[]) {
  return steps.find(
    (step) =>
      step.fixStep && !step.disabledReason && !isTrustStepSatisfied(step),
  );
}

function isTrustStepSatisfied(step: SkillTrustStep) {
  return [
    "passed",
    "completed",
    "present",
    "verified",
    "approved_unverified",
  ].includes(step.status);
}

function releaseEvidenceState(status: string) {
  if (status === "present") return "Evidence artifact is present.";
  if (status === "starter_generated") {
    return "Generated evidence from ThinkWork is present and should be reviewed.";
  }
  return "No release evidence artifact was detected for this step.";
}

function signatureEvidenceState(status: string) {
  switch (status) {
    case "verified":
      return "A signature is present and verified for this catalog snapshot.";
    case "approved_unverified":
      return "Unsigned operator approval evidence is present for this catalog snapshot.";
    case "present_unverified":
      return "A signature file is present, but this session has not verified it.";
    case "missing_signing_config":
      return "Signing configuration is missing; approving will create unverified skill.oms.sig evidence for this catalog snapshot.";
    case "stale":
      return "The signature is stale for the current signed payload hash.";
    case "invalid":
      return "The signature did not verify for the current signed payload hash.";
    default:
      return "No signature evidence was detected for this skill.";
  }
}

function skillSpectorDetails(
  report: SkillTrustReport,
): Array<{ label: string; value: string; monospace?: boolean }> {
  const scanner = report.scanner;
  const details: Array<{ label: string; value: string; monospace?: boolean }> =
    [];
  if (scanner.version)
    details.push({ label: "Version", value: scanner.version });
  if (scanner.riskSeverity) {
    details.push({ label: "Risk severity", value: scanner.riskSeverity });
  }
  if (typeof scanner.riskScore === "number") {
    details.push({ label: "Risk score", value: String(scanner.riskScore) });
  }
  if (scanner.recommendation) {
    details.push({ label: "Recommendation", value: scanner.recommendation });
  }
  if (scanner.error) {
    details.push({ label: "Error", value: scanner.error, monospace: true });
  }
  if (scanner.status === "not_configured") {
    details.push({
      label: "Configuration",
      value:
        "Configure SKILLSPECTOR_BIN for a local scanner or SKILL_TRUST_RUNNER_FUNCTION_NAME for the deployed SkillSpector runner.",
    });
  }
  if (details.length === 0) {
    details.push({
      label: "Output",
      value: "SkillSpector did not return additional scanner metadata.",
    });
  }
  return details;
}

function displayTrustStatus(value: string) {
  if (value === "starter_generated") return "Generated";
  return value.replace(/_/g, " ");
}

function trustEvidenceTone(value: string) {
  if (
    value === "passed" ||
    value === "completed" ||
    value === "present" ||
    value === "verified" ||
    value === "approved_unverified" ||
    value === "starter_generated"
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

function toastTrustFixResult(result: SkillTrustEvidenceFixResult) {
  if (result.fixedStep.status === "prerequisite_missing") {
    toast.info?.(result.fixedStep.message);
    if (!toast.info) toast.success(result.fixedStep.message);
    return;
  }
  if (result.autoPublished) {
    toast.success("Skill approved and published.");
    return;
  }
  if (result.fixedStep.status === "existing_artifact") {
    toast.success(result.fixedStep.message);
    return;
  }
  toast.success(
    result.fixedStep.step === "signature"
      ? result.fixedStep.message
      : result.artifactPath
        ? `Generated ${result.artifactPath}.`
        : result.fixedStep.message,
  );
}

function isSkillDraftExistsError(error: {
  graphQLErrors?: readonly { extensions?: Record<string, unknown> }[];
}): boolean {
  return (
    error.graphQLErrors?.some((graphQLError) => {
      const reason = graphQLError.extensions?.reason;
      return reason === "skill_exists";
    }) ?? false
  );
}

function isMissingWorkspaceFileError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

type SettingsSkillDetailProps =
  | { mode?: "catalog"; skillSlug: string }
  | { mode: "draft"; draftId: string };

export function SettingsSkillDetail(props: SettingsSkillDetailProps) {
  const navigate = useNavigate();
  const isDraft = props.mode === "draft";
  const draftId = isDraft ? props.draftId : null;
  const catalogSkillSlug = isDraft ? null : props.skillSlug;
  const [exporting, setExporting] = useState(false);
  const [publishingDraft, setPublishingDraft] = useState(false);
  const [pendingDraftReplace, setPendingDraftReplace] = useState(false);
  const [skillCardSheetOpen, setSkillCardSheetOpen] = useState(false);
  const [skillCardLoading, setSkillCardLoading] = useState(false);
  const [skillCardContent, setSkillCardContent] = useState("");
  const [skillCardSha256, setSkillCardSha256] = useState<string | null>(null);
  const [evalSheetOpen, setEvalSheetOpen] = useState(false);
  const [trustSheetOpen, setTrustSheetOpen] = useState(false);
  const [trustRunning, setTrustRunning] = useState(false);
  const [trustCacheLoading, setTrustCacheLoading] = useState(false);
  const [trustCacheStale, setTrustCacheStale] = useState(false);
  const [trustReport, setTrustReport] = useState<SkillTrustReport | null>(null);
  const [requestedTrustStepId, setRequestedTrustStepId] =
    useState<SkillTrustStepId | null>(null);
  const [trustFixingStep, setTrustFixingStep] =
    useState<SkillTrustEvidenceFixStepId | null>(null);
  const [trustFixWarning, setTrustFixWarning] = useState<string | null>(null);
  const [editorRefreshVersion, setEditorRefreshVersion] = useState(0);
  const trustInFlightRef = useRef(false);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [{ data: draftData, fetching: loadingDrafts }, refetchDrafts] =
    useQuery({
      query: SettingsSkillDraftsQuery,
      pause: !isDraft,
      requestPolicy: "cache-and-network",
    });
  const [, publishDraftMutation] = useMutation(PublishSkillDraftMutation);

  const draft = isDraft
    ? draftData?.skillDrafts.find((candidate) => candidate.id === draftId)
    : null;
  const draftTitle =
    draft?.displayName?.trim() ||
    draft?.title?.trim() ||
    draft?.slug ||
    "Skill draft";
  const detailTitle = isDraft ? draftTitle : catalogSkillSlug!;
  const trustTargetKey = isDraft
    ? `draft:${draftId ?? "missing"}:${draft?.slug ?? "unknown"}`
    : `catalog:${catalogSkillSlug ?? "missing"}`;
  const trustTarget = useMemo(
    () =>
      isDraft
        ? draftId
          ? { skillDraftId: draftId, slug: draft?.slug }
          : null
        : catalogSkillSlug,
    [catalogSkillSlug, draft?.slug, draftId, isDraft],
  );
  const trustDisplaySlug =
    (isDraft ? draft?.slug || draftTitle : catalogSkillSlug) ?? "Skill draft";

  useEffect(() => {
    if (!trustSheetOpen || !trustTarget || trustReport || trustRunning) {
      return;
    }
    let cancelled = false;
    setTrustCacheLoading(true);
    void getSkillTrustReport(trustTarget)
      .then((cached) => {
        if (cancelled) return;
        if (cached.trustReport) {
          setTrustReport(cached.trustReport);
          setTrustCacheStale(cached.stale);
        } else {
          setTrustCacheStale(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Unknown trust cache failure.";
        toast.error(`Could not load the cached trust report: ${message}`);
      })
      .finally(() => {
        if (!cancelled) setTrustCacheLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trustTarget, trustTargetKey, trustReport, trustRunning, trustSheetOpen]);

  async function exportSkill() {
    if (!catalogSkillSlug) return;
    setExporting(true);
    try {
      const archive = await exportSkillArchive(catalogSkillSlug);
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

  async function runTrust(requestedStepId?: SkillTrustStepId) {
    if (!trustTarget) return;
    if (trustInFlightRef.current) return;
    trustInFlightRef.current = true;
    setTrustRunning(true);
    try {
      const report = await runSkillTrustPipeline(trustTarget);
      setTrustReport(report);
      setTrustCacheStale(false);
      setTrustFixWarning(null);
      if (requestedStepId) {
        setRequestedTrustStepId(requestedStepId);
      }
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

  async function openMissingSkillCardTrustStep() {
    setSkillCardSheetOpen(false);
    setTrustSheetOpen(true);
    setRequestedTrustStepId("skillCard");
    if (!trustReport) {
      await runTrust("skillCard");
    }
  }

  async function openSkillCard() {
    if (!catalogSkillSlug || skillCardLoading) return;
    setSkillCardLoading(true);
    try {
      const file = await skillCatalogClient.getFile(
        { skill: catalogSkillSlug },
        "skill-card.md",
      );
      if (file.content?.trim()) {
        setSkillCardContent(file.content);
        setSkillCardSha256(file.sha256);
        setSkillCardSheetOpen(true);
        return;
      }
      await openMissingSkillCardTrustStep();
    } catch (err) {
      if (isMissingWorkspaceFileError(err)) {
        await openMissingSkillCardTrustStep();
        return;
      }
      const message =
        err instanceof Error ? err.message : "Unknown skill card failure.";
      toast.error(`Could not open the skill card: ${message}`);
    } finally {
      setSkillCardLoading(false);
    }
  }

  async function fixTrustStep(step: SkillTrustEvidenceFixStepId) {
    if (!trustTarget) return;
    if (trustFixingStep) return;
    setTrustFixingStep(step);
    setTrustFixWarning(null);
    try {
      const result = await fixSkillTrustEvidence(trustTarget, step);
      setTrustReport(result.trustReport);
      setTrustCacheStale(false);
      if (result.artifactPath) {
        setEditorRefreshVersion((version) => version + 1);
      }
      if (result.indexWarning) {
        setTrustFixWarning(result.indexWarning);
      }
      toastTrustFixResult(result);
      if (result.autoPublished) {
        const publishedSlug = result.publishedCatalogSlug ?? result.slug;
        refetchDrafts({ requestPolicy: "network-only" });
        navigate({
          to: "/settings/skills/$skillSlug",
          params: { skillSlug: publishedSlug },
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown trust evidence failure.";
      toast.error(`Could not fix the trust step: ${message}`);
    } finally {
      setTrustFixingStep(null);
    }
  }

  async function publishDraft(confirmReplace = false) {
    if (!isDraft || !draftId || !draft) return;
    setPublishingDraft(true);
    try {
      const result = await publishDraftMutation({
        input: { id: draftId, confirmReplace },
      });
      if (result.error) {
        if (isSkillDraftExistsError(result.error)) {
          setPendingDraftReplace(true);
          return;
        }
        toast.error(`Could not publish skill draft: ${result.error.message}`);
        return;
      }

      const publishedSlug =
        result.data?.publishSkillDraft.publishedCatalogSlug ??
        result.data?.publishSkillDraft.slug ??
        draft.slug;
      setPendingDraftReplace(false);
      toast.success("Skill draft published.");
      refetchDrafts({ requestPolicy: "network-only" });
      navigate({
        to: "/settings/skills/$skillSlug",
        params: { skillSlug: publishedSlug },
      });
    } finally {
      setPublishingDraft(false);
    }
  }

  // Title + back navigation relocate to the settings header bar: the "Skill
  // Library" crumb links back to the list, and the sidebar's back button also works.
  usePageHeaderActions({
    title: detailTitle,
    breadcrumbs: [
      {
        label: "Skill Library",
        href: isDraft ? "/settings/skills/drafts" : "/settings/skills",
      },
      { label: detailTitle },
    ],
    action: (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
        {isDraft ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={desktopToolbarButtonClassName}
              aria-label="Publish skill draft"
              title="Publish skill draft"
              disabled={
                publishingDraft ||
                loadingDrafts ||
                !draft ||
                draft.status !== "submitted"
              }
              onClick={() => void publishDraft()}
            >
              {publishingDraft ? (
                <Spinner className="size-4" />
              ) : (
                <UploadCloud className="size-4" />
              )}
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
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={
                skillCardSheetOpen || skillCardLoading
                  ? desktopToolbarActiveButtonClassName
                  : desktopToolbarButtonClassName
              }
              aria-label="Skill card"
              title="Skill card"
              disabled={skillCardLoading}
              onClick={() => void openSkillCard()}
            >
              {skillCardLoading ? (
                <Spinner className="size-4" />
              ) : (
                <FileText className="size-4" />
              )}
            </Button>
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
          </>
        )}
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
        {!isDraft ? (
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
        ) : null}
      </div>
    ),
    actionKey: `skill-actions:${isDraft ? `draft:${draftId}` : `catalog:${catalogSkillSlug}`}:${exporting ? "exporting" : "idle"}:${publishingDraft ? "publishing" : "publish-idle"}:${draft?.status ?? "no-draft"}:${skillCardSheetOpen ? "card" : "card-closed"}:${skillCardLoading ? "card-loading" : "card-idle"}:${evalSheetOpen ? "evals" : "evals-closed"}:${trustSheetOpen ? "trust" : "trust-closed"}:${trustRunning ? "trust-running" : "trust-idle"}:${requestedTrustStepId ?? "no-trust-step"}:${infoSheetOpen ? "info" : "info-closed"}`,
  });

  return (
    <div className="flex h-full flex-col">
      {!isDraft ? (
        <Sheet open={skillCardSheetOpen} onOpenChange={setSkillCardSheetOpen}>
          <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
            <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <SheetTitle>Skill card</SheetTitle>
              <SheetDescription>
                Human-readable summary and governance notes for this skill.
              </SheetDescription>
            </SheetHeader>
            <SkillCardSheetContent
              content={skillCardContent}
              sha256={skillCardSha256}
            />
          </SheetContent>
        </Sheet>
      ) : null}
      {!isDraft ? (
        <Sheet open={evalSheetOpen} onOpenChange={setEvalSheetOpen}>
          <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(480px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
            <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <SheetTitle>Skill evals</SheetTitle>
              <SheetDescription>
                Score, run, and apply held updates for this catalog skill.
              </SheetDescription>
            </SheetHeader>
            <SkillEvalSheetContent skillSlug={catalogSkillSlug!} />
          </SheetContent>
        </Sheet>
      ) : null}
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
        <SheetContent
          className={cn(
            "flex w-full flex-col gap-0 overflow-y-auto",
            SKILL_TRUST_SHEET_WIDTH_CLASS,
          )}
          style={SKILL_TRUST_SHEET_STYLE}
        >
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill trust</SheetTitle>
            <SheetDescription>
              SkillSpector scan, release evidence, and signature status.
            </SheetDescription>
          </SheetHeader>
          <SkillTrustSheetContent
            skillSlug={trustDisplaySlug}
            report={trustReport}
            running={trustRunning}
            loadingCached={trustCacheLoading}
            cacheStale={trustCacheStale}
            fixingStep={trustFixingStep}
            fixWarning={trustFixWarning}
            requestedStepId={requestedTrustStepId}
            onRun={() => void runTrust()}
            onFix={(step) => void fixTrustStep(step)}
            onRequestedStepHandled={() => setRequestedTrustStepId(null)}
          />
        </SheetContent>
      </Sheet>
      <Sheet
        open={pendingDraftReplace}
        onOpenChange={(open) => {
          if (!open && !publishingDraft) setPendingDraftReplace(false);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto p-6 data-[side=right]:w-[min(420px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Replace existing skill?</SheetTitle>
            <SheetDescription>
              {draft
                ? `A catalog skill named ${draft.slug} already exists. Replace it with this approved draft?`
                : "A catalog skill with this slug already exists."}
            </SheetDescription>
          </SheetHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={publishingDraft}
              onClick={() => setPendingDraftReplace(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={publishingDraft || !draft}
              onClick={() => void publishDraft(true)}
            >
              {publishingDraft ? <Spinner className="size-3.5" /> : "Replace"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <div className="min-h-0 flex-1">
        {isDraft ? (
          <WorkspaceFileEditor
            target={{ skillDraftId: draftId! }}
            targetKey={`skill-draft:${draftId}`}
            refreshKey={editorRefreshVersion}
            client={spacesWorkspaceFilesClient}
            defaultOpenFile="SKILL.md"
            bordered={false}
            className="h-full"
            loadingSlot={<LoadingShimmer />}
          />
        ) : (
          <WorkspaceFileEditor
            target={{ skill: catalogSkillSlug! }}
            targetKey={`skill:${catalogSkillSlug}`}
            refreshKey={editorRefreshVersion}
            client={skillCatalogClient}
            defaultOpenFile="SKILL.md"
            bordered={false}
            className="h-full"
            loadingSlot={<LoadingShimmer />}
          />
        )}
      </div>
    </div>
  );
}
