import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Info,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TooltipIconButton,
  type DataTableTokenFilterColumn,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { SettingsKnowledgeBaseBinding } from "@/components/settings/SettingsKnowledgeBaseBinding";
import { KnowledgeBaseFormDialog } from "@/components/settings/KnowledgeBaseFormDialog";
import { KnowledgeBaseRail } from "@/components/settings/KnowledgeBaseRail";
import {
  DeleteKnowledgeBaseMutation,
  KnowledgeBaseDetailQuery,
  RetryKnowledgeBaseMutation,
  SyncKnowledgeBaseMutation,
  TestKnowledgeBaseRetrievalQuery,
  UpdateKnowledgeBaseMutation,
} from "@/lib/kb-queries";
import type { ColumnDef, ColumnFiltersState } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  deleteDocument,
  getDocumentViewUrl,
  listManifestDocuments,
  uploadDocument,
  type KbManifestDocument,
} from "@/lib/kb-files-api";

const ACCEPTED_FILE_TYPES = ".txt,.md,.html,.doc,.docx,.csv,.xls,.xlsx,.pdf";
// Statuses where source ingestion work is in flight — poll until it settles.
const IN_PROGRESS = new Set(["creating", "syncing", "rechunking"]);

function statusVariant(
  status: string,
): "secondary" | "destructive" | "outline" {
  if (status === "active") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

export function SettingsKnowledgeBaseDetail() {
  const { kbId } = useParams({
    from: "/_authed/settings/knowledge-bases/$kbId",
  });
  const navigate = useNavigate();
  const { tenantId } = useTenant();

  const [result, refetch] = useQuery({
    query: KnowledgeBaseDetailQuery,
    variables: { id: kbId },
    requestPolicy: "cache-and-network",
  });
  const kb = result.data?.knowledgeBase ?? null;

  const [, syncKb] = useMutation(SyncKnowledgeBaseMutation);
  const [, retryKb] = useMutation(RetryKnowledgeBaseMutation);
  const [, updateKb] = useMutation(UpdateKnowledgeBaseMutation);
  const [, deleteKb] = useMutation(DeleteKnowledgeBaseMutation);

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // THINK-345 KTD-2: rail visibility and row selection are one piece of
  // state, owned here. Split across components they drift into "rail open
  // with a stale selection".
  const [railOpen, setRailOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );

  const reload = useCallback(
    () => refetch({ requestPolicy: "network-only" }),
    [refetch],
  );

  const runAction = useCallback(
    async (key: string, fn: () => Promise<{ error?: unknown }>) => {
      setBusy(key);
      setActionError(null);
      try {
        const res = await fn();
        if (res.error) {
          setActionError(
            res.error instanceof Error ? res.error.message : String(res.error),
          );
        } else {
          reload();
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  // Document state lives on the page because the header owns Upload and the
  // rail owns the selected document — both outside the table.
  const [docs, setDocs] = useState<KbManifestDocument[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(() => {
    setDocsError(null);
    listManifestDocuments(kbId, 1000, 0)
      .then(({ documents }) => setDocs(documents))
      .catch((e) =>
        setDocsError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [kbId]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setDocsError(null);
      try {
        for (const file of Array.from(files)) {
          await uploadDocument(kbId, file);
        }
        loadDocs();
      } catch (e) {
        setDocsError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
        if (uploadInputRef.current) uploadInputRef.current.value = "";
      }
    },
    [kbId, loadDocs],
  );

  const removeDoc = useCallback(
    async (doc: KbManifestDocument) => {
      setDocsError(null);
      try {
        await deleteDocument(kbId, doc.name);
        setDocs((prev) => prev?.filter((d) => d.id !== doc.id) ?? prev);
        setSelectedDocumentId((prev) => (prev === doc.id ? null : prev));
      } catch (e) {
        setDocsError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [kbId],
  );

  const openDocument = useCallback(
    async (doc: KbManifestDocument) => {
      setDocsError(null);
      setOpening(doc.id);
      // Open the tab synchronously (popup blockers kill window.open calls
      // that happen after an await) and point it at the presigned URL once
      // it resolves.
      const tab = window.open("about:blank", "_blank");
      try {
        const url = await getDocumentViewUrl(kbId, doc.id);
        if (tab) {
          tab.location.href = url;
        } else {
          window.location.href = url;
        }
      } catch (e) {
        tab?.close();
        setDocsError(
          e instanceof Error ? e.message : "Failed to open document",
        );
      } finally {
        setOpening(null);
      }
    },
    [kbId],
  );

  // Derived from `docs` rather than stored, so a reload refreshes whatever
  // the rail is showing instead of pinning a stale copy.
  const selectedDocument = useMemo(
    () => docs?.find((d) => d.id === selectedDocumentId) ?? null,
    [docs, selectedDocumentId],
  );

  const selectDocument = useCallback((doc: KbManifestDocument) => {
    setSelectedDocumentId(doc.id);
    setRailOpen(true);
  }, []);

  // R19: closing the rail clears the selection, so reopening it returns to
  // Knowledge Base settings rather than a document the user forgot about.
  const closeRail = useCallback(() => {
    setRailOpen(false);
    setSelectedDocumentId(null);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((prev) => {
      if (prev) setSelectedDocumentId(null);
      return !prev;
    });
  }, []);

  const inProgressStatus = kb ? IN_PROGRESS.has(kb.status) : false;
  const headerActions = kb ? (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <TooltipIconButton
        size="icon"
        aria-label="Upload documents"
        label="Upload documents"
        disabled={uploading}
        onClick={() => uploadInputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <UploadIcon className="h-4 w-4" />
        )}
      </TooltipIconButton>
      <TooltipIconButton
        size="icon"
        aria-label="Edit source"
        label="Edit name & description"
        onClick={() => setEditOpen(true)}
      >
        <Pencil className="h-4 w-4" />
      </TooltipIconButton>
      <TooltipIconButton
        size="icon"
        aria-label="Sync now"
        label={kb.status === "syncing" ? "Syncing…" : "Sync now"}
        disabled={inProgressStatus || busy !== null}
        onClick={() => runAction("sync", () => syncKb({ id: kb.id }))}
      >
        {busy === "sync" || inProgressStatus ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </TooltipIconButton>
      {/* R5: the operator facts live behind this icon rather than a printed
          strip, so the table starts higher up the page. */}
      <Popover>
        <PopoverTrigger asChild>
          <TooltipIconButton
            size="icon"
            aria-label="Source details"
            label="Source details"
          >
            <Info className="h-4 w-4" />
          </TooltipIconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <dl className="divide-y divide-border text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-muted-foreground">Documents</dt>
              <dd className="tabular-nums">{kb.documentCount ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-muted-foreground">Last sync</dt>
              <dd>{kb.lastSyncStatus ?? "Never"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="shrink-0 text-muted-foreground">Embedding</dt>
              <dd className="break-all text-right font-mono text-xs">
                {kb.embeddingModel}
              </dd>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <dt className="text-muted-foreground">Chunking</dt>
              <dd>
                {kb.chunkingStrategy === "FIXED_SIZE"
                  ? `fixed ${kb.chunkSizeTokens ?? "—"} / ${kb.chunkOverlapPercent ?? "—"}%`
                  : kb.chunkingStrategy.toLowerCase()}
              </dd>
            </div>
          </dl>
        </PopoverContent>
      </Popover>
      <TooltipIconButton
        size="icon"
        aria-label={railOpen ? "Hide details panel" : "Show details panel"}
        label={railOpen ? "Hide details panel" : "Show details panel"}
        onClick={toggleRail}
      >
        <PanelRight className="h-4 w-4" />
      </TooltipIconButton>
    </>
  ) : null;

  usePageHeaderActions({
    title: kb?.name ?? "Knowledge Base",
    breadcrumbs: [
      { label: "Knowledge Bases", href: "/settings/knowledge-bases" },
      { label: kb?.name ?? "Knowledge Base" },
    ],
    action: headerActions,
    // The header only re-registers when this key changes, so every piece of
    // state the icons render from has to appear in it.
    actionKey: [
      kb?.id ?? "none",
      uploading ? "uploading" : "idle",
      railOpen ? "rail-open" : "rail-closed",
      busy ?? "free",
      kb?.status ?? "",
    ].join("|"),
  });

  // Poll while provisioning / syncing / rechunking so the operator sees the KB
  // settle without a manual refresh (spaces' urql cache has no live
  // invalidation — refetch network-only).
  const status = kb?.status ?? "";
  useEffect(() => {
    if (!IN_PROGRESS.has(status)) return;
    const t = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(t);
  }, [status, refetch]);

  if (result.fetching && !kb) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="w-full px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This Knowledge Base could not be found. It may have been removed.
        </p>
      </div>
    );
  }

  const inProgress = IN_PROGRESS.has(kb.status);

  const railSettings = (
    <>
      <SyncSection kb={kb} />

      <ChunkingSection
        kb={kb}
        disabled={inProgress || busy !== null}
        onSave={(input) =>
          runAction("rechunk", () => updateKb({ id: kb.id, input }))
        }
      />

      <TestRetrievalSection kbId={kb.id} status={kb.status} />

      {tenantId ? (
        <SettingsKnowledgeBaseBinding kbId={kb.id} tenantId={tenantId} />
      ) : null}

      <div className="mt-4 flex flex-col items-stretch gap-2">
        {confirmDelete ? (
          <>
            <span className="text-sm text-muted-foreground">
              Delete this Knowledge Base and all its documents?
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy === "delete"}
              onClick={() =>
                runAction("delete", async () => {
                  const res = await deleteKb({ id: kb.id });
                  if (!res.error) navigate({ to: "/settings/knowledge-bases" });
                  return res;
                })
              }
            >
              {busy === "delete" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Delete
            </Button>
          </>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmDelete(true)}
          >
            Delete source
          </Button>
        )}
      </div>
    </>
  );

  // Fixed-height shell, matching SettingsTablePane: the page itself never
  // scrolls, the table body and the panel scroll independently, and the pager
  // stays pinned to the bottom.
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{kb.name}</h1>
          <Badge variant={statusVariant(kb.status)}>{kb.status}</Badge>
        </div>

        {/* R5: only the description is printed here — the counts live behind
            the header's source-details icon so the table starts high. */}
        {kb.description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {kb.description}
          </p>
        ) : null}

        <KnowledgeBaseFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={reload}
          kb={{
            id: kb.id,
            name: kb.name,
            description: kb.description,
          }}
        />

        {actionError ? (
          <p className="mt-4 text-sm text-destructive">{actionError}</p>
        ) : null}

        {kb.status === "failed" && kb.errorMessage ? (
          <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              Provisioning failed
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {kb.errorMessage}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={busy === "retry"}
              onClick={() => runAction("retry", () => retryKb({ id: kb.id }))}
            >
              {busy === "retry" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Retry provisioning
            </Button>
          </div>
        ) : null}
      </div>

      <DocumentsTable
        docs={docs}
        error={docsError}
        opening={opening}
        selectedDocumentId={selectedDocumentId}
        onSelect={selectDocument}
        onOpen={openDocument}
        onRemove={removeDoc}
        panel={
          railOpen ? (
            <KnowledgeBaseRail
              selectedDocument={selectedDocument}
              settings={railSettings}
              onClose={closeRail}
            />
          ) : null
        }
      />
    </div>
  );
}

function docStatusVariant(
  status: string,
): "secondary" | "destructive" | "outline" {
  if (status === "indexed") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

// THINK-345 KTD-5: the collapsible search-icon toolbar is duplicated across
// Memory, Knowledge Graph, Workflows, Work Items, and the Twenty account
// index. Extracting a shared component would touch five call sites, so this
// is a sixth local copy and the consolidation is a follow-up.
function DocumentsToolbarSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || value.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const clear = () => {
    onChange("");
    setExpanded(false);
  };

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search documents"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(20rem,calc(100vw-2rem))] items-center">
      <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search documents"
        placeholder="Search documents..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 pr-8 text-sm shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={value}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            clear();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        onMouseDown={(e) => e.preventDefault()}
        onClick={clear}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function DocumentsTable({
  docs,
  error,
  opening,
  selectedDocumentId,
  onSelect,
  onOpen,
  onRemove,
  panel,
}: {
  docs: KbManifestDocument[] | null;
  error: string | null;
  opening: string | null;
  selectedDocumentId: string | null;
  onSelect: (doc: KbManifestDocument) => void;
  onOpen: (doc: KbManifestDocument) => void;
  onRemove: (doc: KbManifestDocument) => void;
  /** Side panel rendered beside the table, matching its height. */
  panel?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const rows = useMemo(() => docs ?? [], [docs]);

  const facetColumns: DataTableTokenFilterColumn[] = useMemo(
    () => [
      {
        id: "sourceKind",
        label: "Source",
        type: "option",
        options: [
          { value: "s3-connect", label: "Connected bucket" },
          { value: "managed-upload", label: "Upload" },
        ],
      },
      {
        id: "status",
        label: "Status",
        type: "option",
        options: Array.from(new Set(rows.map((r) => r.status)))
          .sort()
          .map((value) => ({ value, label: value })),
      },
    ],
    [rows],
  );

  const filterColumns = useMemo<ColumnDef<KbManifestDocument>[]>(
    () => [
      {
        id: "sourceKind",
        accessorKey: "sourceKind",
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        id: "status",
        accessorKey: "status",
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );

  // KTD-3: DataTableTokenFilter needs a TanStack table instance, which
  // DataTable does not expose. Same shape as SettingsMemory — a headless
  // table owns filter state and its filtered rows feed the display table.
  const filterTable = useReactTable({
    data: rows,
    columns: filterColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const activeFilters = filterTable.getState().columnFilters;
  const filteredRows = useMemo(
    () => filterTable.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterTable, activeFilters, rows],
  );

  const columns = useMemo<ColumnDef<KbManifestDocument>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        // No explicit size: with table-fixed + sized siblings, Name takes all
        // remaining width; max-w-0 lets the truncate actually clip.
        meta: { cellClassName: "max-w-0" },
        cell: ({ row }) => (
          <span
            className="block truncate text-sm text-foreground"
            title={row.original.documentKey}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "sourceKind",
        header: "Source",
        // NOTE: 150 is TanStack's default and the colgroup ignores it as
        // "not explicit" — keep this any value other than 150.
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.sourceKind === "s3-connect"
              ? "Connected bucket"
              : "Upload"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <Badge variant={docStatusVariant(row.original.status)}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            {/* R10: the only affordance that opens the document. Row click
                selects instead, so scanning never spawns a tab. */}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Open ${row.original.name} in a new tab`}
              disabled={opening === row.original.id}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(row.original);
              }}
            >
              {opening === row.original.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
            </Button>
            {row.original.sourceKind === "managed-upload" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`More actions for ${row.original.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(row.original);
                    }}
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ),
      },
    ],
    [opening, onOpen, onRemove],
  );

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <DocumentsToolbarSearch value={search} onChange={setSearch} />
        <DataTableTokenFilter
          table={filterTable}
          columns={facetColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear filters"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
      </div>

      {/* The panel sits beside the table, inside the content area, and
          stretches to the table's height — it is not a full-page rail. Both
          columns scroll internally; the page itself does not. */}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="px-1 py-3 text-sm text-destructive">{error}</div>
          ) : docs === null ? (
            <div className="px-1 py-3 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredRows}
              filterValue={search}
              filterColumn="name"
              pageSize={25}
              scrollable
              allowHorizontalScroll={false}
              tableClassName="table-fixed"
              onRowClick={onSelect}
              rowClassName={(row) =>
                row.id === selectedDocumentId ? "bg-muted/60" : undefined
              }
              emptyState={
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No documents yet. Upload files or connect a bucket, then sync
                  to index them.
                </div>
              }
            />
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}

type KbDetail = {
  id: string;
  name: string;
  description?: string | null;
  embeddingModel: string;
  chunkingStrategy: string;
  chunkSizeTokens?: number | null;
  chunkOverlapPercent?: number | null;
  status: string;
  awsKbId?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  documentCount?: number | null;
  errorMessage?: string | null;
};

// The sync action moved to the header icon and the counts moved to the
// summary strip (R4, R5), so this keeps only what neither of those carries.
function SyncSection({ kb }: { kb: KbDetail }) {
  return (
    <SettingsSection label="Sync">
      <SettingsRow label="Status">
        <Badge variant={statusVariant(kb.status)}>{kb.status}</Badge>
      </SettingsRow>
      <SettingsRow label="Bedrock KB">
        <span className="break-all text-right font-mono text-xs">
          {kb.awsKbId ?? "—"}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}

function ChunkingSection({
  kb,
  disabled,
  onSave,
}: {
  kb: KbDetail;
  disabled: boolean;
  onSave: (input: {
    chunkingStrategy: string;
    chunkSizeTokens: number;
    chunkOverlapPercent: number;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [strategy, setStrategy] = useState(kb.chunkingStrategy);
  const [size, setSize] = useState(kb.chunkSizeTokens ?? 300);
  const [overlap, setOverlap] = useState(kb.chunkOverlapPercent ?? 20);

  if (!editing) {
    return (
      <SettingsSection
        label="Chunking"
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        }
      >
        <SettingsRow label="Strategy">{kb.chunkingStrategy}</SettingsRow>
        <SettingsRow label="Chunk size (tokens)">
          {kb.chunkSizeTokens ?? "—"}
        </SettingsRow>
        <SettingsRow label="Overlap (%)">
          {kb.chunkOverlapPercent ?? "—"}
        </SettingsRow>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection label="Chunking">
      <div className="space-y-4 p-4">
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          Changing chunking <strong>reprocesses every document</strong>.
          Retrieval is briefly unavailable until re-indexing completes.
        </p>
        <div className="space-y-1.5">
          <Label>Strategy</Label>
          <Select value={strategy} onValueChange={setStrategy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FIXED_SIZE">Fixed size</SelectItem>
              <SelectItem value="NONE">None (no chunking)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {strategy === "FIXED_SIZE" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Chunk size (tokens)</Label>
              <Input
                type="number"
                value={size}
                min={100}
                max={1000}
                step={50}
                onChange={(e) => setSize(Number(e.target.value) || 300)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Overlap (%)</Label>
              <Input
                type="number"
                value={overlap}
                min={0}
                max={50}
                step={5}
                onChange={(e) => setOverlap(Number(e.target.value) || 20)}
              />
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              onSave({
                chunkingStrategy: strategy,
                chunkSizeTokens: size,
                chunkOverlapPercent: overlap,
              });
              setEditing(false);
            }}
          >
            Save &amp; reprocess
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

function TestRetrievalSection({
  kbId,
  status,
}: {
  kbId: string;
  status: string;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, runTest] = useQuery({
    query: TestKnowledgeBaseRetrievalQuery,
    variables: { id: kbId, query: submitted },
    pause: !submitted,
    requestPolicy: "network-only",
  });

  const data = result.data?.testKnowledgeBaseRetrieval;
  const notProvisioned = status === "failed" || status === "creating";

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    if (q === submitted) runTest({ requestPolicy: "network-only" });
    else setSubmitted(q);
  };

  const clear = () => {
    setQuery("");
    setSubmitted("");
  };

  const hasContent = query.trim() !== "" || submitted !== "";

  return (
    <SettingsSection
      label="Test retrieval"
      action={
        !notProvisioned && hasContent ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={result.fetching}
            onClick={clear}
          >
            Clear
          </Button>
        ) : null
      }
    >
      <div className="space-y-3 p-4">
        {notProvisioned ? (
          <p className="text-sm text-muted-foreground">
            This Knowledge Base is not provisioned yet. Retry provisioning
            before testing retrieval.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                placeholder="Ask what the agent would retrieve…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <Button
                size="sm"
                disabled={!query.trim() || result.fetching}
                onClick={submit}
              >
                {result.fetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Run"
                )}
              </Button>
            </div>
            {result.error ? (
              <p className="text-sm text-destructive">{result.error.message}</p>
            ) : null}
            {submitted && data ? (
              data.status === "not_provisioned" ? (
                <p className="text-sm text-muted-foreground">
                  Not provisioned yet — retry provisioning first.
                </p>
              ) : data.hits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No matching results for “{submitted}”.
                </p>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {data.hits.map((hit, i) => (
                    <div key={i} className="px-3 py-2.5">
                      <p className="text-sm text-foreground">{hit.snippet}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {typeof hit.score === "number"
                          ? `score ${hit.score.toFixed(3)}`
                          : null}
                        {hit.source ? ` · ${hit.source}` : null}
                      </p>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </>
        )}
      </div>
    </SettingsSection>
  );
}
