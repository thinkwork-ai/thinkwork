import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Download, Info } from "lucide-react";
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
  skillCatalogClient,
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

export function SettingsSkillDetail() {
  const { skillSlug } = useParams({
    from: "/_authed/settings/skills/$skillSlug",
  });
  const [exporting, setExporting] = useState(false);
  const [evalSheetOpen, setEvalSheetOpen] = useState(false);
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
    actionKey: `skill-actions:${skillSlug}:${exporting ? "exporting" : "idle"}:${evalSheetOpen ? "evals" : "evals-closed"}:${infoSheetOpen ? "info" : "info-closed"}`,
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
