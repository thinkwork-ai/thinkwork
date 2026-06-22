import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
  Spinner,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { ApiError } from "@/lib/api-fetch";
import {
  importSkillArchiveAsDraft,
  listSkillSummaries,
  type SkillSummary,
} from "@/lib/workspace-files-api";
import {
  SetSkillEvalGateMutation,
  SkillEvalGateQuery,
  SkillEvalScoreQuery,
} from "@/lib/evaluation-queries";
import { SettingsSkillDraftsQuery } from "@/lib/skill-creator-queries";
import { formatPassRatePct } from "@/lib/skill-eval-format";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { desktopToolbarButtonClassName } from "@/lib/desktop-chrome";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

type SkillsView = "published" | "drafts";
const SKILL_LIBRARY_PUBLISHED_ROUTE = "/settings/skills";
const SKILL_LIBRARY_DRAFTS_ROUTE = "/settings/skills/drafts";

/**
 * Per-skill score cell (U9). Each row reads its own `skillEvalScore` — urql
 * caches the per-(tenant, skill) document, so revisiting the list is cheap.
 * "Unrated" (no enabled cases) is a neutral state, never a failure; a rated
 * skill with no completed run yet shows "—" rather than 0%.
 */
function SkillEvalScoreCell({ skillSlug }: { skillSlug: string }) {
  const { tenantId } = useTenant();
  const [{ data, fetching }] = useQuery({
    query: SkillEvalScoreQuery,
    variables: { tenantId: tenantId ?? "", skillSlug },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const score = data?.skillEvalScore;

  if (!score) {
    return (
      <span className="text-muted-foreground">{fetching ? "…" : "—"}</span>
    );
  }
  if (!score.rated) {
    return <span className="text-muted-foreground">Unrated</span>;
  }
  const pct = formatPassRatePct(score.passRate);
  if (pct == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium tabular-nums">{pct}</span>
      {score.regression ? (
        <Badge variant="destructive">Regression</Badge>
      ) : null}
    </span>
  );
}

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

  const columns = useMemo<ColumnDef<SkillSummary>[]>(
    () => [
      {
        accessorKey: "slug",
        header: "Skill",
        size: 240,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.displayName?.trim() || row.original.slug}
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block truncate text-muted-foreground">
            {row.original.description?.trim() || "—"}
          </span>
        ),
      },
      {
        id: "score",
        header: "Eval score",
        size: 140,
        cell: ({ row }) => <SkillEvalScoreCell skillSlug={row.original.slug} />,
      },
    ],
    [],
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
  );
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
      <div className="grid grid-cols-[minmax(0,1fr)_220px_120px] gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
        <span>Draft</span>
        <span>Requested by</span>
        <span>Status</span>
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
            className="grid w-full grid-cols-[minmax(0,1fr)_220px_120px] items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring last:border-b-0"
            onClick={() => onOpenDraft(draft)}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {label}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">{draft.slug}</span>
                {draft.source.threadId ? (
                  <span className="font-mono">
                    Thread {draft.source.threadId}
                  </span>
                ) : null}
              </div>
              {draft.summary ? (
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {draft.summary}
                </p>
              ) : null}
            </div>
            <span className="truncate text-sm text-muted-foreground">
              {requester}
            </span>
            <SkillDraftStatusBadge status={draft.status} />
          </button>
        );
      })}
    </div>
  );
}

function SkillDraftStatusBadge({ status }: { status: string }) {
  const className =
    status === "submitted"
      ? "border-blue-500/60 text-blue-600 dark:text-blue-300"
      : status === "published"
        ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-300"
        : status === "failed" || status === "rejected"
          ? "border-red-500/60 text-red-600 dark:text-red-300"
          : "border-amber-500/60 text-amber-600 dark:text-amber-300";

  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
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
