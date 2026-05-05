import {
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Trash2,
  Upload,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  KnowledgeBaseDetailQuery,
  UpdateKnowledgeBaseMutation,
  DeleteKnowledgeBaseMutation,
  SyncKnowledgeBaseMutation,
} from "@/lib/graphql-queries";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  type KbDocument,
} from "@/lib/knowledge-base-api";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/knowledge-bases/$kbId",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/knowledge/knowledge-bases/$kbId",
      params,
      replace: true,
    });
  },
  component: KnowledgeBaseDetailPage,
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

type KnowledgeBaseDetailPageProps = {
  embedded?: boolean;
  listHref?: "/knowledge-bases" | "/knowledge/knowledge-bases";
};

export function KnowledgeBaseDetailPage({
  embedded = false,
  listHref = "/knowledge-bases",
}: KnowledgeBaseDetailPageProps = {}) {
  const { kbId } = useParams({ strict: false }) as { kbId: string };
  const navigate = useNavigate();

  const [result, reexecute] = useQuery({
    query: KnowledgeBaseDetailQuery,
    variables: { id: kbId },
  });

  const [, updateKb] = useMutation(UpdateKnowledgeBaseMutation);
  const [, deleteKb] = useMutation(DeleteKnowledgeBaseMutation);
  const [, syncKb] = useMutation(SyncKnowledgeBaseMutation);

  const kb = (result.data as any)?.knowledgeBase;

  useBreadcrumbs([
    { label: "Brain", href: "/knowledge/memory" },
    { label: "KBs", href: listHref },
    { label: kb?.name ?? "Loading..." },
  ]);

  // Documents state
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  // Load documents
  useEffect(() => {
    if (!kbId) return;
    setLoadingDocs(true);
    listDocuments(kbId)
      .then(setDocs)
      .catch(console.error)
      .finally(() => setLoadingDocs(false));
  }, [kbId]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await uploadDocument(kbId, file);
      }
      const updated = await listDocuments(kbId);
      setDocs(updated);
    } catch (err: any) {
      console.error("Upload failed:", err);
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (filename: string) => {
    try {
      await deleteDocument(kbId, filename);
      setDocs((prev) => prev.filter((d) => d.name !== filename));
    } catch (err) {
      console.error("Delete doc failed:", err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncKb({ id: kbId });
      refresh();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    const res = await deleteKb({ id: kbId });
    if (!res.error) {
      navigate({ to: listHref });
    }
  };

  // Poll for status updates when syncing
  useEffect(() => {
    if (!kb || kb.status !== "syncing") return;
    const interval = setInterval(() => {
      reexecute({ requestPolicy: "network-only" });
    }, 5000);
    return () => clearInterval(interval);
  }, [kb?.status, reexecute]);

  if ((result.fetching && !result.data) || !kb) return <PageSkeleton />;

  const header = (
    <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              {kb.name}
            </h1>
            <p className="ml-auto text-sm text-muted-foreground">{kb.slug}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={kb.status} />
            {kb.lastSyncStatus && (
              <StatusBadge status={kb.lastSyncStatus.toLowerCase()} />
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm text-muted-foreground">Delete this KB?</span>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            )}
          </div>
        </div>
  );

  const content = (
      <div className="space-y-6">
        {/* Description */}
        {kb.description && (
          <p className="text-sm text-muted-foreground">{kb.description}</p>
        )}

        {/* Error message */}
        {kb.errorMessage && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {kb.errorMessage}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Documents Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Documents</CardTitle>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.html,.doc,.docx,.csv,.xls,.xlsx,.pdf"
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Upload
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 p-0 pb-2">
              {uploadError && (
                <div className="mx-4 mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {uploadError}
                </div>
              )}
              {loadingDocs ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                </div>
              ) : docs.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-3">
                  No documents uploaded. Upload files to populate this knowledge base.
                </p>
              ) : (
                docs.map((doc) => (
                  <div
                    key={doc.name}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(doc.size)}
                          {doc.lastModified && ` \u00b7 ${relativeTime(doc.lastModified)}`}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteDoc(doc.name)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Sync Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Sync</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing || kb.status === "syncing" || kb.status === "creating"}
              >
                {syncing || kb.status === "syncing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync Now
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{kb.status}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last Sync</p>
                  <p className="font-medium">
                    {kb.lastSyncAt ? relativeTime(kb.lastSyncAt) : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Documents</p>
                  <p className="font-medium">{kb.documentCount ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Sync Status</p>
                  <p className="font-medium capitalize">
                    {kb.lastSyncStatus?.toLowerCase() ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Chunking</p>
                  <p className="font-medium">
                    {kb.chunkingStrategy} ({kb.chunkSizeTokens} tokens,{" "}
                    {kb.chunkOverlapPercent}% overlap)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Embedding Model</p>
                  <p className="font-medium text-xs truncate">{kb.embeddingModel}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <div className="shrink-0 pb-4">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      </div>
    );
  }

  return (
    <PageLayout header={header}>
      {content}
    </PageLayout>
  );
}
