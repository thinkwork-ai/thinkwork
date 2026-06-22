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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  importSkillArchive,
  listSkillSummaries,
  type SkillSummary,
} from "@/lib/workspace-files-api";
import {
  SetSkillEvalGateMutation,
  SkillEvalGateQuery,
  SkillEvalScoreQuery,
} from "@/lib/evaluation-queries";
import {
  PublishSkillDraftMutation,
  SettingsSkillDraftsQuery,
} from "@/lib/skill-creator-queries";
import { formatPassRatePct } from "@/lib/skill-eval-format";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { desktopToolbarButtonClassName } from "@/lib/desktop-chrome";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

interface PendingReplace {
  slug: string;
  archiveBase64: string;
}

interface PendingDraftReplace {
  id: string;
  slug: string;
}

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
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(
    null,
  );
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(
    null,
  );
  const [pendingDraftReplace, setPendingDraftReplace] =
    useState<PendingDraftReplace | null>(null);

  const [
    { data: draftData, fetching: loadingDrafts, error: draftError },
    refetchDrafts,
  ] = useQuery({
    query: SettingsSkillDraftsQuery,
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: publishingDraft }, publishDraftMutation] = useMutation(
    PublishSkillDraftMutation,
  );

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
    async (archiveBase64: string, confirmReplace = false) => {
      setImporting(true);
      try {
        const result = await importSkillArchive(archiveBase64, {
          confirmReplace,
        });
        try {
          await loadSkills();
        } catch (refreshError) {
          toast.warning(
            `Skill ${result.status === "updated" ? "updated" : "imported"}, but the list could not refresh: ${importErrorMessage(refreshError)}`,
          );
        }
        setPendingReplace(null);
        toast.success(
          result.status === "updated" ? "Skill updated." : "Skill imported.",
        );
        for (const warning of [
          result.indexWarning,
          result.evalDatasetWarning,
        ]) {
          if (warning) toast.warning(warning);
        }
        navigate({
          to: "/settings/skills/$skillSlug",
          params: { skillSlug: result.slug },
        });
      } catch (e) {
        if (isSkillExistsError(e)) {
          setPendingReplace({
            slug: String(e.body.slug),
            archiveBase64,
          });
          return;
        }
        toast.error(importErrorMessage(e));
      } finally {
        setImporting(false);
        resetFileInput();
      }
    },
    [loadSkills, navigate, resetFileInput],
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

  const publishDraft = useCallback(
    async (
      draft: Pick<SkillDraftSummary, "id" | "slug">,
      confirmReplace = false,
    ) => {
      setPublishingDraftId(draft.id);
      try {
        const result = await publishDraftMutation({
          input: { id: draft.id, confirmReplace },
        });
        if (result.error) {
          if (isSkillDraftExistsError(result.error)) {
            setPendingDraftReplace({ id: draft.id, slug: draft.slug });
            return;
          }
          toast.error(`Could not publish skill draft: ${result.error.message}`);
          return;
        }

        const publishedSlug =
          result.data?.publishSkillDraft.publishedCatalogSlug ??
          result.data?.publishSkillDraft.slug ??
          draft.slug;
        setPendingDraftReplace(null);
        toast.success("Skill draft published.");
        refetchDrafts({ requestPolicy: "network-only" });
        try {
          await loadSkills();
        } catch (refreshError) {
          toast.warning(
            `Skill draft published, but the catalog list could not refresh: ${importErrorMessage(refreshError)}`,
          );
        }
        navigate({
          to: "/settings/skills/$skillSlug",
          params: { skillSlug: publishedSlug },
        });
      } finally {
        setPublishingDraftId(null);
      }
    },
    [loadSkills, navigate, publishDraftMutation, refetchDrafts],
  );

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
          publishingDraftId={publishingDraftId}
          publishingDraft={publishingDraft}
          onPublish={(draft) => void publishDraft(draft)}
        />
      )}
      <Dialog
        open={Boolean(pendingDraftReplace)}
        onOpenChange={(open) => {
          if (!open && !publishingDraft) setPendingDraftReplace(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace existing skill?</DialogTitle>
            <DialogDescription>
              {pendingDraftReplace
                ? `A catalog skill named ${pendingDraftReplace.slug} already exists. Replace it with this approved draft?`
                : "A catalog skill with this slug already exists."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={publishingDraft}
              onClick={() => setPendingDraftReplace(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={publishingDraft || !pendingDraftReplace}
              onClick={() => {
                if (!pendingDraftReplace) return;
                void publishDraft(pendingDraftReplace, true);
              }}
            >
              {publishingDraft ? <Spinner className="size-3.5" /> : "Replace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingReplace)}
        onOpenChange={(open) => {
          if (!open && !importing) setPendingReplace(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace existing skill?</DialogTitle>
            <DialogDescription>
              {pendingReplace
                ? `A catalog skill named ${pendingReplace.slug} already exists. Replace it with this archive?`
                : "A catalog skill with this slug already exists."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setPendingReplace(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={importing || !pendingReplace}
              onClick={() => {
                if (!pendingReplace) return;
                void runImport(pendingReplace.archiveBase64, true);
              }}
            >
              {importing ? <Spinner className="size-3.5" /> : "Replace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsTablePane>
  );
}

function SkillDraftList({
  drafts,
  publishingDraftId,
  publishingDraft,
  onPublish,
}: {
  drafts: SkillDraftSummary[];
  publishingDraftId: string | null;
  publishingDraft: boolean;
  onPublish: (draft: SkillDraftSummary) => void;
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
      <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
        <span>Draft</span>
        <span>Status</span>
        <span className="text-right">Action</span>
      </div>
      {drafts.map((draft) => {
        const label = draft.displayName?.trim() || draft.title || draft.slug;
        const busy = publishingDraft && publishingDraftId === draft.id;
        return (
          <div
            key={draft.id}
            className="grid grid-cols-[minmax(0,1fr)_120px_140px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {label}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">{draft.slug}</span>
                {draft.requester?.name || draft.requester?.email ? (
                  <span>
                    Requested by {draft.requester.name ?? draft.requester.email}
                  </span>
                ) : null}
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
            <SkillDraftStatusBadge status={draft.status} />
            <div className="text-right">
              {draft.status === "submitted" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={publishingDraft}
                  onClick={() => onPublish(draft)}
                >
                  {busy ? <Spinner className="size-3.5" /> : "Publish"}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
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

function isSkillExistsError(error: unknown): error is ApiError & {
  body: { code: "skill_exists"; slug: string };
} {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  if (typeof error.body !== "object" || error.body === null) return false;
  const body = error.body as { code?: unknown; slug?: unknown };
  return body.code === "skill_exists" && typeof body.slug === "string";
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
