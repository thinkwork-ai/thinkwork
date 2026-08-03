import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, Loader2 } from "lucide-react";
import { ViewerClient } from "@zrimo/viewer";
import "@zrimo/viewer/styles.css";
import { Button } from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { isSignedDocLink } from "@/lib/knowledge-doc-viewer";
import { openInNewTab } from "@/lib/open-in-new-tab";

/** Zrimo's self-hosted WASM/font/worker assets (the vendor-assets script
 * copies them into public/vendor/zrimo — served from the app origin, never
 * a CDN). */
const ZRIMO_ASSET_PATH = "/vendor/zrimo/";

/** Paged documents open fitted to width; spreadsheets have no page to fit
 * and "width" lands on an arbitrary zoom, so they open at 100%. */
function initialFitFor(fileName: string): "width" | "none" {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ["xlsx", "xls", "csv", "tsv"].includes(extension) ? "none" : "width";
}

function displayName(documentKey: string): string {
  const base = documentKey.slice(documentKey.lastIndexOf("/") + 1);
  return base || documentKey;
}

type ViewerPhase =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; reason: string };

/**
 * In-app viewer for cited knowledge documents. Office formats have no
 * native browser renderer, so the signed /kb/doc link a thread citation
 * carries used to just download them. This page fetches the same link as
 * JSON (Accept: application/json → {url}, the click-time presign), then
 * fetches the S3 bytes and renders them with Zrimo — client-side WASM, so
 * the document never transits a conversion service. Requires the knowledge
 * server's DOC_LINK_CORS_ORIGINS and the evidence bucket's viewer CORS to
 * include this app's origin.
 */
export function KnowledgeDocumentViewer({
  src,
  documentKey,
  page,
  embedded = false,
  onBack,
}: {
  /** Signed doc-link URL the citation carried (validated before fetching). */
  src?: string;
  documentKey?: string;
  page?: number;
  /** Docked inside the thread artifact panel (THINK-168): fill the host
   * instead of the viewport, and skip the page chrome (context strip,
   * document.title) — the panel header carries title and actions. */
  embedded?: boolean;
  /** Full-screen view reached by same-tab navigation from a thread: renders
   * a back affordance in the context strip. Page mode only. */
  onBack?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The fetched bytes, kept for the Download action — no second presign.
  const blobRef = useRef<Blob | null>(null);
  const [state, setState] = useState<ViewerPhase>({ phase: "loading" });
  const fileName = documentKey ? displayName(documentKey) : "";

  const onDownload = useCallback(() => {
    const blob = blobRef.current;
    if (blob && fileName) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return;
    }
    // Bytes not in hand (load failed) — fall back to the plain doc-link
    // navigation, which 302s to a fresh presign.
    if (src) openInNewTab(src);
  }, [src, fileName]);

  useEffect(() => {
    if (embedded) return;
    document.title = fileName ? `${fileName} · ThinkWork` : "ThinkWork";
  }, [embedded, fileName]);

  useEffect(() => {
    if (!src || !documentKey) {
      setState({ phase: "error", reason: "No document in the URL." });
      return;
    }
    if (!isSignedDocLink(src)) {
      setState({
        phase: "error",
        reason: "This link is not a signed knowledge-document link.",
      });
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setState({ phase: "loading" });
    const client = ViewerClient.create({
      assetBaseUrl: new URL(ZRIMO_ASSET_PATH, window.location.href),
    });
    const viewer = client.createViewer({
      container,
      ui: true,
      fit: initialFitFor(fileName),
    });

    void (async () => {
      const link = await fetch(src, {
        headers: { accept: "application/json" },
      });
      if (!link.ok) {
        const reason =
          link.status === 403
            ? "the link has expired — re-run the search for a fresh one"
            : `the document link could not be resolved (HTTP ${link.status})`;
        throw new Error(reason);
      }
      // JSON mode hands back the click-time presigned URL; a server that
      // ignored the Accept header and answered with the bytes still works.
      let blob: Blob;
      if (link.headers.get("content-type")?.includes("application/json")) {
        const { url } = (await link.json()) as { url?: string };
        if (!url) throw new Error("the document link returned no view URL");
        const bytes = await fetch(url);
        if (!bytes.ok) {
          throw new Error(`document fetch failed (HTTP ${bytes.status})`);
        }
        blob = await bytes.blob();
      } else {
        blob = await link.blob();
      }
      if (cancelled) return;
      blobRef.current = blob;
      await viewer.load(blob, { fileName });
      if (!cancelled) setState({ phase: "ready" });
    })().catch((error: unknown) => {
      if (cancelled) return;
      setState({
        phase: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      cancelled = true;
      void viewer.destroy().then(() => client.destroy());
    };
  }, [src, documentKey, fileName]);

  return (
    // Full-bleed focused view: the viewer IS the page — no app shell, just a
    // slim context strip over the document (back affordance only when the
    // host navigated here in-tab). Embedded (thread panel), the strip is
    // dropped — the panel header owns title and actions.
    <div
      className={cn(
        "knowledge-doc-viewer flex min-h-0 flex-col bg-background text-foreground",
        embedded ? "h-full" : "h-dvh",
      )}
    >
      {embedded ? null : (
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            {onBack ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Back"
                className="-ml-2 mr-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onBack}
                data-testid="document-view-back"
              >
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
            ) : null}
            <FileText
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate font-medium">{fileName || "…"}</span>
            {page ? (
              <span className="shrink-0 text-muted-foreground">p.{page}</span>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Download original"
            onClick={onDownload}
          >
            <Download className="size-4" aria-hidden />
          </Button>
        </header>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="h-full w-full"
          data-testid="knowledge-viewer-container"
        />
        {state.phase === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Loading document"
            />
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-10 text-center"
            data-testid="knowledge-viewer-error"
          >
            <p className="text-sm text-muted-foreground" role="alert">
              This document could not be rendered — {state.reason}
            </p>
            {src ? (
              <Button size="sm" variant="outline" onClick={onDownload}>
                <Download className="size-3.5" aria-hidden /> Download instead
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
