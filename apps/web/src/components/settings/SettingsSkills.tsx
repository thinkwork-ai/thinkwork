import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Upload } from "lucide-react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import type { SkillDraftSummary } from "@/gql/graphql";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "@thinkwork/ui";
import { Response } from "@/components/ai-elements/response";
import { useTenant } from "@/context/TenantContext";
import { ApiError } from "@/lib/api-fetch";
import {
  fixSkillTrustEvidence,
  getSkillTrustReport,
  importSkillArchiveAsDraft,
  listSkillSummaries,
  runSkillTrustPipeline,
  skillCatalogClient,
  type SkillSummary,
  type SkillTrustEvidenceFixStepId,
  type SkillTrustEvidenceFixResult,
  type SkillTrustReport,
} from "@/lib/workspace-files-api";
import {
  SetSkillEvalGateMutation,
  SkillEvalGateQuery,
} from "@/lib/evaluation-queries";
import { SettingsSkillDraftsQuery } from "@/lib/skill-creator-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { desktopToolbarButtonClassName } from "@/lib/desktop-chrome";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

type SkillsView = "published" | "drafts";
const SKILL_LIBRARY_PUBLISHED_ROUTE = "/settings/skills";
const SKILL_LIBRARY_DRAFTS_ROUTE = "/settings/skills/drafts";
const SKILL_DRAFT_TABLE_GRID = "grid-cols-[minmax(0,1fr)_220px_150px_150px]";

/**
 * Per-tenant skill-update gate control (U6). A finite threshold HOLDS a skill
 * UPDATE whose candidate version scores below it until an operator applies it
 * (or overrides). No gate = nothing blocks. Operator-only (the whole Skills
 * surface is OperatorGuard-wrapped; the mutation re-checks requireTenantAdmin).
 */
function SkillEvalGateControl() {
  const { tenantId } = useTenant();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [{ data, fetching }, refetchGate] = useQuery({
    query: SkillEvalGateQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ fetching: saving }, setGate] = useMutation(SetSkillEvalGateMutation);

  const gate = data?.skillEvalGate;
  const thresholdPct =
    gate?.threshold != null ? Math.round(gate.threshold * 100) : null;

  // Seed the draft from the saved threshold each time the popover opens.
  useEffect(() => {
    if (open) setDraft(thresholdPct != null ? String(thresholdPct) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save(threshold: number | null) {
    if (!tenantId) return;
    const result = await setGate({ tenantId, threshold });
    if (result.error) {
      toast.error(`Could not update the gate: ${result.error.message}`);
      return;
    }
    refetchGate({ requestPolicy: "network-only" });
    setOpen(false);
    toast.success(
      threshold == null
        ? "Skill-update gate turned off."
        : `Skill-update gate set to ${Math.round(threshold * 100)}%.`,
    );
  }

  const parsed = Number(draft);
  const draftValid =
    draft.trim().length > 0 &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 100;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="skill-gate-trigger">
          {fetching && !gate ? (
            <Spinner className="size-3.5" />
          ) : (
            <>
              Update gate:{" "}
              <span className="font-semibold tabular-nums">
                {thresholdPct != null ? `${thresholdPct}%` : "Off"}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="skill-gate-threshold">Skill-update gate</Label>
            <p className="text-xs text-muted-foreground">
              Hold a skill update when its candidate version scores below this
              until an operator applies it. Unrated skills are never held.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="skill-gate-threshold"
              data-testid="skill-gate-input"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              placeholder="e.g. 80"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">% passing</span>
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="skill-gate-off"
              disabled={saving || !gate?.enabled}
              onClick={() => void save(null)}
            >
              Turn off
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="skill-gate-save"
              disabled={saving || !draftValid}
              onClick={() => void save(parsed / 100)}
            >
              {saving ? <Spinner className="size-3.5" /> : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SettingsSkills({ tab = "published" }: { tab?: SkillsView }) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const view = tab;
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [skillCardOpeningSlug, setSkillCardOpeningSlug] = useState<
    string | null
  >(null);
  const [skillCardSheet, setSkillCardSheet] = useState<{
    skill: SkillSummary;
    content: string;
    sha256: string | null;
  } | null>(null);
  const [trustSheetSkill, setTrustSheetSkill] = useState<SkillSummary | null>(
    null,
  );
  const [trustReport, setTrustReport] = useState<SkillTrustReport | null>(null);
  const [trustCacheLoading, setTrustCacheLoading] = useState(false);
  const [trustCacheStale, setTrustCacheStale] = useState(false);
  const [trustRunning, setTrustRunning] = useState(false);
  const [trustFixingStep, setTrustFixingStep] =
    useState<SkillTrustEvidenceFixStepId | null>(null);
  const [trustFixWarning, setTrustFixWarning] = useState<string | null>(null);

  const [
    { data: draftData, fetching: loadingDrafts, error: draftError },
    refetchDrafts,
  ] = useQuery({
    query: SettingsSkillDraftsQuery,
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const loadSkills = useCallback(
    async (cancelled?: () => boolean) => {
      if (!tenantId) return;
      setError(null);
      const summaries = await listSkillSummaries();
      if (!cancelled?.()) setSkills(summaries);
    },
    [tenantId],
  );

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    loadSkills(() => cancelled).catch(
      (e) =>
        !cancelled &&
        setError(e instanceof Error ? e.message : "Failed to load skills"),
    );
    return () => {
      cancelled = true;
    };
  }, [loadSkills, tenantId]);

  const resetFileInput = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const runImport = useCallback(
    async (archiveBase64: string) => {
      setImporting(true);
      try {
        const result = await importSkillArchiveAsDraft(archiveBase64);
        refetchDrafts({ requestPolicy: "network-only" });
        toast.success("Skill draft imported for review.");
        navigate({
          to: "/settings/skills/drafts/$draftId",
          params: { draftId: result.draftId },
        });
      } catch (e) {
        toast.error(importErrorMessage(e));
      } finally {
        setImporting(false);
        resetFileInput();
      }
    },
    [navigate, refetchDrafts, resetFileInput],
  );

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!isZipFile(file)) {
        toast.error("Choose a .zip skill archive.");
        resetFileInput();
        return;
      }
      try {
        const archiveBase64 = await fileToBase64(file);
        await runImport(archiveBase64);
      } catch (e) {
        toast.error(importErrorMessage(e));
        resetFileInput();
      }
    },
    [resetFileInput, runImport],
  );

  const rows = useMemo<SkillSummary[]>(() => skills ?? [], [skills]);
  const draftRows = useMemo<SkillDraftSummary[]>(
    () => draftData?.skillDrafts ?? [],
    [draftData?.skillDrafts],
  );
  const submittedDraftCount = draftRows.filter(
    (draft) => draft.status === "submitted",
  ).length;

  const refreshSkillTrustSummary = useCallback((report: SkillTrustReport) => {
    setSkills(
      (current) =>
        current?.map((skill) =>
          skill.slug === report.slug
            ? {
                ...skill,
                trustStatus: report.status,
                trustStale: false,
                trustUpdatedAt: report.generatedAt,
                skillCardStatus: report.evidence.skillCard,
              }
            : skill,
        ) ?? current,
    );
  }, []);

  const openSkillCardBadge = useCallback(
    async (skill: SkillSummary, event: MouseEvent) => {
      event.stopPropagation();
      if (!isSkillCardAvailable(skill.skillCardStatus)) return;
      setSkillCardOpeningSlug(skill.slug);
      try {
        const file = await skillCatalogClient.getFile(
          { skill: skill.slug },
          "skill-card.md",
        );
        if (!file.content?.trim()) {
          toast.error("The skill card is empty.");
          return;
        }
        setSkillCardSheet({
          skill,
          content: file.content,
          sha256: file.sha256,
        });
      } catch (e) {
        toast.error(
          `Could not open the skill card: ${
            e instanceof Error ? e.message : "Unknown skill card failure."
          }`,
        );
      } finally {
        setSkillCardOpeningSlug(null);
      }
    },
    [],
  );

  const openTrustBadge = useCallback(
    async (skill: SkillSummary, event: MouseEvent) => {
      event.stopPropagation();
      setTrustSheetSkill(skill);
      setTrustReport(null);
      setTrustCacheStale(false);
      setTrustFixWarning(null);
      setTrustCacheLoading(true);
      try {
        const cached = await getSkillTrustReport(skill.slug);
        setTrustReport(cached.trustReport);
        setTrustCacheStale(cached.stale);
        if (cached.trustReport) refreshSkillTrustSummary(cached.trustReport);
      } catch (e) {
        toast.error(
          `Could not load the cached trust report: ${
            e instanceof Error ? e.message : "Unknown trust report failure."
          }`,
        );
      } finally {
        setTrustCacheLoading(false);
      }
    },
    [refreshSkillTrustSummary],
  );

  const runTrustForSelectedSkill = useCallback(async () => {
    if (!trustSheetSkill || trustRunning) return;
    setTrustRunning(true);
    try {
      const report = await runSkillTrustPipeline(trustSheetSkill.slug);
      setTrustReport(report);
      setTrustCacheStale(false);
      setTrustFixWarning(null);
      refreshSkillTrustSummary(report);
      toast.success("Skill trust pipeline completed.");
    } catch (e) {
      toast.error(
        `Could not run the trust pipeline: ${
          e instanceof Error ? e.message : "Unknown trust pipeline failure."
        }`,
      );
    } finally {
      setTrustRunning(false);
    }
  }, [refreshSkillTrustSummary, trustRunning, trustSheetSkill]);

  const fixTrustStep = useCallback(
    async (step: SkillTrustEvidenceFixStepId) => {
      if (!trustSheetSkill || trustFixingStep) return;
      setTrustFixingStep(step);
      setTrustFixWarning(null);
      try {
        const result = await fixSkillTrustEvidence(trustSheetSkill.slug, step);
        setTrustReport(result.trustReport);
        setTrustCacheStale(false);
        refreshSkillTrustSummary(result.trustReport);
        if (result.indexWarning) setTrustFixWarning(result.indexWarning);
        toastTrustFixResult(result);
      } catch (e) {
        toast.error(
          `Could not generate the trust component: ${
            e instanceof Error ? e.message : "Unknown trust fix failure."
          }`,
        );
      } finally {
        setTrustFixingStep(null);
      }
    },
    [refreshSkillTrustSummary, trustFixingStep, trustSheetSkill],
  );

  const columns = useMemo<ColumnDef<SkillSummary>[]>(
    () => [
      {
        accessorKey: "slug",
        header: "Name",
        size: 320,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.displayName?.trim() || row.original.slug}
          </span>
        ),
      },
      {
        id: "skillCard",
        header: "Skill card",
        size: 150,
        cell: ({ row }) => (
          <SkillLibraryStatusBadgeButton
            label={skillCardLabel(row.original.skillCardStatus)}
            tone={skillCardTone(row.original.skillCardStatus)}
            disabled={!isSkillCardAvailable(row.original.skillCardStatus)}
            loading={skillCardOpeningSlug === row.original.slug}
            ariaLabel={`Open skill card for ${
              row.original.displayName?.trim() || row.original.slug
            }`}
            onClick={(event) => void openSkillCardBadge(row.original, event)}
          />
        ),
      },
      {
        id: "trust",
        header: "Trust pipeline",
        size: 170,
        cell: ({ row }) => (
          <SkillLibraryStatusBadgeButton
            label={trustPipelineLabel(row.original)}
            tone={trustPipelineTone(row.original)}
            ariaLabel={`Open trust pipeline for ${
              row.original.displayName?.trim() || row.original.slug
            }`}
            onClick={(event) => void openTrustBadge(row.original, event)}
          />
        ),
      },
    ],
    [openSkillCardBadge, openTrustBadge, skillCardOpeningSlug],
  );

  const importAction = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={desktopToolbarButtonClassName}
      aria-label="Import skill archive"
      title="Import skill archive"
      disabled={importing}
      onClick={() => fileInputRef.current?.click()}
    >
      {importing ? (
        <Spinner className="size-4" />
      ) : (
        <Upload className="size-4" />
      )}
    </Button>
  );

  usePageHeaderActions({
    title: "Skill Library",
    breadcrumbs: [{ label: "Skill Library" }],
    tabs: [
      { to: SKILL_LIBRARY_PUBLISHED_ROUTE, label: "Published" },
      {
        to: SKILL_LIBRARY_DRAFTS_ROUTE,
        label:
          submittedDraftCount > 0
            ? `Drafts (${submittedDraftCount})`
            : "Drafts",
      },
    ],
    action: importAction,
    actionKey: [
      "skill-library",
      view,
      importing ? "importing" : "idle",
      submittedDraftCount,
    ].join(":"),
  });

  return (
    <>
      <Sheet
        open={Boolean(skillCardSheet)}
        onOpenChange={(open) => {
          if (!open) setSkillCardSheet(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill card</SheetTitle>
            <SheetDescription>
              Human-readable summary and governance notes for this skill.
            </SheetDescription>
          </SheetHeader>
          {skillCardSheet ? (
            <SkillLibraryCardSheetContent
              content={skillCardSheet.content}
              sha256={skillCardSheet.sha256}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet
        open={Boolean(trustSheetSkill)}
        onOpenChange={(open) => {
          if (!open) {
            setTrustSheetSkill(null);
            setTrustReport(null);
            setTrustCacheStale(false);
            setTrustFixWarning(null);
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <SheetTitle>Skill trust</SheetTitle>
            <SheetDescription>
              SkillSpector scan, release evidence, and signature status.
            </SheetDescription>
          </SheetHeader>
          {trustSheetSkill ? (
            <SkillLibraryTrustSheetContent
              skill={trustSheetSkill}
              report={trustReport}
              loadingCached={trustCacheLoading}
              cacheStale={trustCacheStale}
              running={trustRunning}
              fixingStep={trustFixingStep}
              fixWarning={trustFixWarning}
              onRun={() => void runTrustForSelectedSkill()}
              onFix={(step) => void fixTrustStep(step)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <SettingsTablePane
        title="Skill Library"
        description="Browse, install, and manage the skills your agents can use."
        loading={
          view === "published"
            ? !skills && !error
            : loadingDrafts && !draftData && !draftError
        }
        embedded
        toolbar={
          view === "published" ? (
            <div
              className="flex w-full flex-wrap items-center gap-3"
              data-testid="skill-published-toolbar"
            >
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <Input
                  placeholder="Search skills…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-[240px] max-w-sm flex-1"
                />
              )}
              <div
                className="ml-auto flex shrink-0 items-center gap-2"
                data-testid="skill-published-toolbar-actions"
              >
                <SkillEvalGateControl />
              </div>
            </div>
          ) : null
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          data-testid="skill-import-input"
          onChange={handleImportFile}
        />
        {view === "published" ? (
          <DataTable
            columns={columns}
            data={rows}
            filterValue={search}
            filterColumn="slug"
            scrollable
            allowHorizontalScroll={false}
            pageSize={25}
            tableClassName="table-fixed"
            onRowClick={(row) =>
              navigate({
                to: "/settings/skills/$skillSlug",
                params: { skillSlug: row.slug },
              })
            }
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                No skills in the catalog yet.
              </div>
            }
          />
        ) : draftError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 p-4 text-sm text-destructive"
          >
            Could not load skill drafts: {draftError.message}
          </div>
        ) : (
          <SkillDraftList
            drafts={draftRows}
            onOpenDraft={(draft) =>
              navigate({
                to: "/settings/skills/drafts/$draftId",
                params: { draftId: draft.id },
              })
            }
          />
        )}
      </SettingsTablePane>
    </>
  );
}

function SkillLibraryStatusBadgeButton({
  label,
  tone,
  ariaLabel,
  disabled = false,
  loading = false,
  onClick,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  ariaLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        "inline-flex max-w-full justify-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70",
        statusToneClassName(tone),
      ].join(" ")}
    >
      {loading ? "Opening..." : label}
    </button>
  );
}

function skillCardLabel(status: SkillSummary["skillCardStatus"]) {
  if (status === "starter_generated" || status === "present") {
    return "Available";
  }
  if (status === "missing") return "Missing";
  return "Not run";
}

function skillCardTone(
  status: SkillSummary["skillCardStatus"],
): "success" | "warning" | "danger" | "neutral" {
  if (status === "present" || status === "starter_generated") {
    return "success";
  }
  if (status === "missing") return "warning";
  return "neutral";
}

function isSkillCardAvailable(status: SkillSummary["skillCardStatus"]) {
  return status === "present" || status === "starter_generated";
}

function trustPipelineLabel(skill: SkillSummary) {
  if (!skill.trustStatus) return "Not run";
  if (skill.trustStale) return "Stale";
  if (skill.trustStatus === "passed") return "Passed";
  if (skill.trustStatus === "review") return "Review";
  if (skill.trustStatus === "blocked") return "Blocked";
  return "Failed";
}

function trustPipelineTone(
  skill: SkillSummary,
): "success" | "warning" | "danger" | "neutral" {
  if (!skill.trustStatus) return "neutral";
  if (skill.trustStale) return "warning";
  if (skill.trustStatus === "passed") return "success";
  if (skill.trustStatus === "review") return "warning";
  return "danger";
}

function SkillLibraryCardSheetContent({
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

function SkillLibraryTrustSheetContent({
  skill,
  report,
  loadingCached,
  cacheStale,
  running,
  fixingStep,
  fixWarning,
  onRun,
  onFix,
}: {
  skill: SkillSummary;
  report: SkillTrustReport | null;
  loadingCached: boolean;
  cacheStale: boolean;
  running: boolean;
  fixingStep: SkillTrustEvidenceFixStepId | null;
  fixWarning: string | null;
  onRun: () => void;
  onFix: (step: SkillTrustEvidenceFixStepId) => void;
}) {
  const [selectedStepId, setSelectedStepId] = useState<SkillTrustStepId | null>(
    null,
  );
  const effectiveSkill = report
    ? {
        ...skill,
        trustStatus: report.status,
        trustStale: false,
        skillCardStatus: report.evidence.skillCard,
      }
    : skill;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Pipeline status
            </span>
            <Badge
              variant="outline"
              className={statusToneClassName(trustPipelineTone(effectiveSkill))}
            >
              {trustPipelineLabel(effectiveSkill)}
            </Badge>
          </div>
          {report ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
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
            <p className="mt-2 text-sm text-muted-foreground">
              Loading cached trust report...
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No cached trust report has been generated yet.
            </p>
          )}
        </div>
        <Button type="button" size="sm" disabled={running} onClick={onRun}>
          {running ? <Spinner className="size-3.5" /> : "Run pipeline"}
        </Button>
      </div>

      <div className="grid gap-2">
        {report ? (
          <>
            {steps.map((step) => (
              <TrustEvidenceRow
                key={step.id}
                step={step}
                selected={step.id === selectedStep?.id}
                fixing={fixingStep === step.id}
                onSelect={() => setSelectedStepId(step.id)}
              />
            ))}
            <Sheet
              open={Boolean(selectedStep)}
              onOpenChange={(open) => {
                if (!open) setSelectedStepId(null);
              }}
            >
              <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(520px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
                <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
                  <SheetTitle>{selectedStep?.label ?? "Trust step"}</SheetTitle>
                  <SheetDescription>
                    Purpose, current evidence state, and available fix action.
                  </SheetDescription>
                </SheetHeader>
                {selectedStep ? (
                  <TrustStepDetail
                    skillSlug={skill.slug}
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
          </>
        ) : (
          <>
            <StaticTrustEvidenceRow
              label="Skill card"
              value={skill.skillCardStatus ?? "not_run"}
            />
            <StaticTrustEvidenceRow
              label="Trust pipeline"
              value={skill.trustStatus ?? "not_run"}
            />
          </>
        )}
      </div>

      {report ? (
        <>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Severity counts
            </p>
            <div className="mt-3 grid grid-cols-5 gap-3 text-center">
              {(["critical", "high", "medium", "low", "info"] as const).map(
                (severity) => (
                  <div key={severity}>
                    <div className="text-lg font-semibold tabular-nums">
                      {report.severityCounts[severity] ?? 0}
                    </div>
                    <div className="text-xs capitalize text-muted-foreground">
                      {severity}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {report.contentHash}
          </p>
        </>
      ) : null}
    </div>
  );
}

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
  const displayValue = formatTrustEvidenceValue(step.status);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${step.label} trust step: ${displayValue}`}
      className={[
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-background/30 px-3 py-2 text-left transition hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring",
        statusRowToneClassName(tone),
        selected ? "bg-muted/40" : "",
      ].join(" ")}
      onClick={onSelect}
    >
      <span className="min-w-0 truncate text-xs uppercase tracking-wide text-muted-foreground">
        {step.label}
      </span>
      <Badge variant="outline" className={statusToneClassName(tone)}>
        {fixing ? "Generating" : displayValue}
      </Badge>
    </button>
  );
}

function StaticTrustEvidenceRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const tone = trustEvidenceTone(value);
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
        statusRowToneClassName(tone),
      ].join(" ")}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Badge variant="outline" className={statusToneClassName(tone)}>
        {formatTrustEvidenceValue(value)}
      </Badge>
    </div>
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
          className={statusToneClassName(trustEvidenceTone(step.status))}
        >
          {formatTrustEvidenceValue(step.status)}
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
        className={[
          "break-words text-sm",
          monospace ? "font-mono text-xs text-muted-foreground" : "",
        ].join(" ")}
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
        report.evidence.signature === "present_unverified" ||
        report.evidence.signature === "stale" ||
        report.evidence.signature === "invalid"
          ? "signature"
          : undefined,
      fixLabel: "Approve and sign",
      disabledReason:
        report.evidence.signature === "missing_signing_config"
          ? "Signing is not configured for this environment, so ThinkWork cannot generate a real skill.oms.sig file."
          : undefined,
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

function isTrustStepSatisfied(step: SkillTrustStep) {
  return ["passed", "completed", "present", "verified"].includes(step.status);
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
    case "present_unverified":
      return "A signature file is present, but this session has not verified it.";
    case "missing_signing_config":
      return "Signing configuration is missing, so no real signature can be generated here.";
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

function toastTrustFixResult(result: SkillTrustEvidenceFixResult) {
  if (result.fixedStep.status === "prerequisite_missing") {
    toast.info?.(result.fixedStep.message);
    if (!toast.info) toast.success(result.fixedStep.message);
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

function statusToneClassName(
  tone: "success" | "warning" | "danger" | "neutral",
) {
  if (tone === "success") {
    return "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (tone === "warning") {
    return "border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  if (tone === "danger") {
    return "border-destructive/50 bg-destructive/10 text-destructive";
  }
  return "border-border/70 bg-muted/20 text-muted-foreground";
}

function statusRowToneClassName(
  tone: "success" | "warning" | "danger" | "neutral",
) {
  if (tone === "success") return "border-emerald-500/45";
  if (tone === "warning") return "border-amber-500/45";
  if (tone === "danger") return "border-destructive/50";
  return "border-border";
}

function trustEvidenceTone(
  value: string,
): "success" | "warning" | "danger" | "neutral" {
  if (
    value === "passed" ||
    value === "completed" ||
    value === "present" ||
    value === "starter_generated" ||
    value === "verified"
  ) {
    return "success";
  }
  if (value === "failed" || value === "blocked" || value === "invalid") {
    return "danger";
  }
  if (value === "not_run") return "neutral";
  return "warning";
}

function formatTrustEvidenceValue(value: string) {
  if (value === "starter_generated") return "Generated";
  if (value === "not_configured") return "Not configured";
  if (value === "present_unverified") return "Present unverified";
  if (value === "missing_signing_config") return "Missing signing config";
  if (value === "evalDataset") return "Evals";
  if (value === "not_run") return "Not run";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SkillDraftList({
  drafts,
  onOpenDraft,
}: {
  drafts: SkillDraftSummary[];
  onOpenDraft: (draft: SkillDraftSummary) => void;
}) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-md border border-border py-10 text-center text-sm text-muted-foreground">
        No skill drafts are waiting for review.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div
        className={[
          "grid gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase text-muted-foreground",
          SKILL_DRAFT_TABLE_GRID,
        ].join(" ")}
      >
        <span>Name</span>
        <span>Requested by</span>
        <span>Skill card</span>
        <span>Trust card</span>
      </div>
      {drafts.map((draft) => {
        const label = draft.displayName?.trim() || draft.title || draft.slug;
        const requester =
          draft.requester?.name?.trim() ||
          draft.requester?.email?.trim() ||
          "Unknown";
        return (
          <button
            type="button"
            key={draft.id}
            className={[
              "grid w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring last:border-b-0",
              SKILL_DRAFT_TABLE_GRID,
            ].join(" ")}
            onClick={() => onOpenDraft(draft)}
          >
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {label}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {requester}
            </span>
            <span>
              <Badge
                variant="outline"
                className={statusToneClassName("neutral")}
              >
                Not run
              </Badge>
            </span>
            <span>
              <Badge
                variant="outline"
                className={statusToneClassName("neutral")}
              >
                Not run
              </Badge>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function isZipFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.body === "object" && error.body !== null) {
      const body = error.body as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Could not import skill.";
}
