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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import { formatPassRatePct } from "@/lib/skill-eval-format";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

interface PendingReplace {
  slug: string;
  archiveBase64: string;
}

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

export function SettingsSkills() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(
    null,
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

  return (
    <SettingsTablePane
      title="Skill Library"
      description="Browse, install, and manage the skills your agents can use."
      loading={!skills && !error}
      toolbar={
        <div className="flex w-full items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Input
              placeholder="Search skills…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Import skill archive"
                  disabled={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {importing ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import skill archive</TooltipContent>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              data-testid="skill-import-input"
              onChange={handleImportFile}
            />
            <SkillEvalGateControl />
          </div>
        </div>
      }
    >
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
