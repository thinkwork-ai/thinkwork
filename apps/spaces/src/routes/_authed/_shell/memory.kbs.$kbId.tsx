import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "urql";
import { ArrowLeft, BookOpen, FileText } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from "@thinkwork/ui";
import { ComputerKnowledgeBaseDetailQuery } from "@/lib/graphql-queries";
import { listDocuments, type KbDocument } from "@/lib/kb-files-api";

interface KnowledgeBaseDetailResult {
  knowledgeBase?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    embeddingModel: string | null;
    chunkingStrategy: string | null;
    chunkSizeTokens: number | null;
    chunkOverlapPercent: number | null;
    status: string;
    awsKbId: string | null;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    documentCount: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export const Route = createFileRoute("/_authed/_shell/memory/kbs/$kbId")({
  component: KbDetailPage,
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ready: "bg-green-500/20 text-green-400",
    syncing: "bg-yellow-500/20 text-yellow-400",
    failed: "bg-red-500/20 text-red-400",
  };
  return (
    <Badge className={`${colors[status] ?? "bg-muted text-muted-foreground"} font-normal text-xs`}>
      {status}
    </Badge>
  );
}

function KbDetailPage() {
  const { kbId } = Route.useParams();

  const [{ data, fetching }] = useQuery<KnowledgeBaseDetailResult>({
    query: ComputerKnowledgeBaseDetailQuery,
    variables: { id: kbId },
  });

  const kb = data?.knowledgeBase;

  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  useEffect(() => {
    if (!kbId) return;
    setLoadingDocs(true);
    setDocsError(null);
    listDocuments(kbId)
      .then(setDocs)
      .catch((err) => {
        console.error("[KB detail] listDocuments failed:", err);
        setDocsError("Documents are unavailable. Ask your operator if this persists.");
      })
      .finally(() => setLoadingDocs(false));
  }, [kbId]);

  if (fetching && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    );
  }

  if (!kb) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Knowledge base not found, or your tenant has no access to it.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="space-y-2">
        <Link
          to="/memory/kbs"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Knowledge Bases
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
            {kb.name}
          </h1>
          <StatusBadge status={kb.status} />
          <p className="ml-auto text-sm text-muted-foreground">{kb.slug}</p>
        </div>
        {kb.description && (
          <p className="text-sm text-muted-foreground">{kb.description}</p>
        )}
        {kb.errorMessage && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {kb.errorMessage}
          </p>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Embedding Model
            </p>
            <p className="mt-0.5">{kb.embeddingModel ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Chunking Strategy
            </p>
            <p className="mt-0.5">{kb.chunkingStrategy ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Chunk Size (tokens)
            </p>
            <p className="mt-0.5">{kb.chunkSizeTokens ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Chunk Overlap
            </p>
            <p className="mt-0.5">
              {kb.chunkOverlapPercent != null ? `${kb.chunkOverlapPercent}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Documents
            </p>
            <p className="mt-0.5">{kb.documentCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider font-medium">
              Last Sync
            </p>
            <p className="mt-0.5">
              {kb.lastSyncAt
                ? new Date(kb.lastSyncAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "Never"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingDocs ? (
            <p className="text-sm text-muted-foreground">Loading documents…</p>
          ) : docsError ? (
            <p className="text-sm text-muted-foreground">{docsError}</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents in this knowledge base yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {docs.map((d) => (
                <li
                  key={d.name}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(d.size)} ·{" "}
                    {new Date(d.lastModified).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Knowledge bases are managed by your operator. Ask them to add or remove documents.
      </p>
    </div>
  );
}
