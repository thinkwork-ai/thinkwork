import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "@thinkwork/shared-utils";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { Loader2, Pencil } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { SettingsKnowledgeBaseBinding } from "@/components/settings/SettingsKnowledgeBaseBinding";
import { KnowledgeBaseFormDialog } from "@/components/settings/KnowledgeBaseFormDialog";
import {
  DeleteKnowledgeBaseMutation,
  KnowledgeBaseDetailQuery,
  RetryKnowledgeBaseMutation,
  SyncKnowledgeBaseMutation,
  TestKnowledgeBaseRetrievalQuery,
  UpdateKnowledgeBaseMutation,
} from "@/lib/kb-queries";
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type KbDocument,
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

  usePageHeaderActions({
    title: kb?.name ?? "Brain Source",
    breadcrumbs: [
      { label: "Brain Sources", href: "/settings/knowledge-bases" },
      { label: kb?.name ?? "Brain Source" },
    ],
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

  if (result.fetching && !kb) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">
          This Brain Source could not be found. It may have been removed.
        </p>
      </div>
    );
  }

  const inProgress = IN_PROGRESS.has(kb.status);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <SettingsPageTitle
          title={kb.name}
          description={kb.description ?? undefined}
          badge={<Badge variant={statusVariant(kb.status)}>{kb.status}</Badge>}
          actions={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Edit source"
              title="Edit name & description"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />

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
          <p className="mb-4 text-sm text-destructive">{actionError}</p>
        ) : null}

        {kb.status === "failed" && kb.errorMessage ? (
          <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
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

        <DocumentsSection kbId={kb.id} />

        <SyncSection
          kb={kb}
          inProgress={inProgress}
          busy={busy}
          onSync={() => runAction("sync", () => syncKb({ id: kb.id }))}
        />

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

        <div className="flex items-center justify-end gap-2">
          {confirmDelete ? (
            <>
              <span className="text-sm text-muted-foreground">
                Delete this Brain Source and all its documents?
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
                    if (!res.error)
                      navigate({ to: "/settings/knowledge-bases" });
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
              onClick={() => setConfirmDelete(true)}
            >
              Delete source
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentsSection({ kbId }: { kbId: string }) {
  const [docs, setDocs] = useState<KbDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setError(null);
    listDocuments(kbId)
      .then(setDocs)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [kbId]);

  useEffect(() => {
    load();
  }, [load]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          await uploadDocument(kbId, file);
        }
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kbId, load],
  );

  const remove = useCallback(
    async (filename: string) => {
      setError(null);
      try {
        await deleteDocument(kbId, filename);
        setDocs((prev) => prev?.filter((d) => d.name !== filename) ?? prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [kbId],
  );

  return (
    <SettingsSection
      label="Documents"
      action={
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Upload
          </Button>
        </>
      }
    >
      {error ? (
        <div className="px-4 py-3 text-sm text-destructive">{error}</div>
      ) : docs === null ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          No documents yet. Upload files, then sync to index them.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {docs.map((doc) => (
            <div
              key={doc.name}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{doc.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.size)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(doc.name)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
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

function SyncSection({
  kb,
  inProgress,
  busy,
  onSync,
}: {
  kb: KbDetail;
  inProgress: boolean;
  busy: string | null;
  onSync: () => void;
}) {
  return (
    <SettingsSection
      label="Sync"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={inProgress || busy !== null}
          onClick={onSync}
        >
          {busy === "sync" || inProgress ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {kb.status === "syncing" ? "Syncing…" : "Sync now"}
        </Button>
      }
    >
      <SettingsRow label="Status">
        <Badge variant={statusVariant(kb.status)}>{kb.status}</Badge>
      </SettingsRow>
      <SettingsRow label="Documents indexed">
        <span className="tabular-nums">{kb.documentCount ?? 0}</span>
      </SettingsRow>
      <SettingsRow label="Last sync">
        {kb.lastSyncStatus ?? "Never"}
      </SettingsRow>
      <SettingsRow label="Embedding model">
        <span className="font-mono text-xs">{kb.embeddingModel}</span>
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
            This Brain Source is not provisioned yet. Retry provisioning before
            testing retrieval.
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
