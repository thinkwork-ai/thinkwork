import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { History } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import { ArtifactVersionContentQuery } from "@/lib/graphql-queries";
import { ThreadJsonRenderRenderer } from "@/components/workbench/json-render/ThreadJsonRenderRenderer";
import { relativeTime } from "@/lib/utils";
import { parseLivingCanvasPart } from "./canvas-content";

export interface CanvasVersion {
  id: string;
  version: number;
  contentHash?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

interface VersionContentResult {
  artifact?: {
    versions?: Array<{
      id: string;
      version: number;
      content?: string | null;
    }> | null;
  } | null;
}

/**
 * Version history for a canvas artifact (R11). Lists pinned versions newest
 * first; clicking one opens it read-only. Pinned versions are content-addressed
 * and write-once — this is a viewer, never an editor.
 */
export function CanvasVersionHistory({
  artifactId,
  versions,
  headVersion,
}: {
  artifactId: string;
  versions: CanvasVersion[];
  headVersion: number;
}) {
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  if (versions.length === 0) {
    return (
      <section className="grid gap-2" data-testid="canvas-version-history">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <History className="size-4" /> Version history
        </h2>
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No pinned versions yet. Pinning a version snapshots the current
          canvas.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-2" data-testid="canvas-version-history">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <History className="size-4" /> Version history
      </h2>
      <ul className="divide-y rounded-md border">
        {versions.map((version) => (
          <li
            key={version.id}
            className="flex items-center justify-between gap-3 p-3"
            data-testid="canvas-version-row"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Version {version.version}
                {version.version === headVersion ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (current)
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {version.createdAt ? relativeTime(version.createdAt) : "—"}
                {version.contentHash
                  ? ` · ${version.contentHash.slice(0, 12)}`
                  : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpenVersion(version.version)}
              data-testid="canvas-version-view"
            >
              View
            </Button>
          </li>
        ))}
      </ul>
      <VersionViewerDialog
        artifactId={artifactId}
        version={openVersion}
        onClose={() => setOpenVersion(null)}
      />
    </section>
  );
}

function VersionViewerDialog({
  artifactId,
  version,
  onClose,
}: {
  artifactId: string;
  version: number | null;
  onClose: () => void;
}) {
  const [{ data, fetching, error }] = useQuery<VersionContentResult>({
    query: ArtifactVersionContentQuery,
    variables: { id: artifactId },
    pause: version === null,
    requestPolicy: "cache-and-network",
  });

  const selected = useMemo(() => {
    if (version === null) return null;
    const row = data?.artifact?.versions?.find((v) => v.version === version);
    return row ? parseLivingCanvasPart(row.content) : null;
  }, [data?.artifact?.versions, version]);

  return (
    <Dialog open={version !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="canvas-version-viewer">
        <DialogHeader>
          <DialogTitle>Version {version} (read-only)</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {fetching && !selected ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error.message}</p>
          ) : selected ? (
            <ThreadJsonRenderRenderer
              data={selected.data}
              partId={selected.id}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              This version has no readable canvas payload.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
