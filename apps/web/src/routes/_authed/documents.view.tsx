import {
  createFileRoute,
  useCanGoBack,
  useRouter,
} from "@tanstack/react-router";
import { ArrowLeft, FileText } from "lucide-react";
import { TooltipIconButton } from "@thinkwork/ui";
import { KnowledgeDocumentViewer } from "@/components/documents/KnowledgeDocumentViewer";
import {
  isSignedDocLink,
  knowledgeDocumentFileName,
  opensInDocumentViewer,
} from "@/lib/knowledge-doc-viewer";

/**
 * In-app full-screen viewer for cited knowledge documents. Reached from the
 * thread artifact panel's "Full screen" affordance (same-tab navigation, so
 * a back button returns to the thread) and from legacy new-tab links.
 * Authed but chromeless on purpose: a document view is a focused artifact,
 * so it sits under _authed as a sibling of _shell and carries no app
 * navigation beyond the back affordance.
 *
 * Office/CSV render via the Zrimo viewer; browser-native formats (pdf/txt/
 * md…) render in a frame on the signed link, keeping the native PDF
 * viewer's chrome and #page= deep link.
 */
export const Route = createFileRoute("/_authed/documents/view")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { src?: string; key?: string; page?: number } => ({
    ...(typeof search.src === "string" && search.src
      ? { src: search.src }
      : {}),
    ...(typeof search.key === "string" && search.key
      ? { key: search.key }
      : {}),
    ...(Number.isFinite(Number(search.page)) && Number(search.page) > 0
      ? { page: Number(search.page) }
      : {}),
  }),
  component: DocumentViewRoute,
});

function DocumentViewRoute() {
  const { src, key, page } = Route.useSearch();
  const router = useRouter();
  // Opened in a fresh tab (legacy links) there is no history to go back to —
  // hide the affordance rather than render a dead button.
  const onBack = useCanGoBack() ? () => router.history.back() : undefined;

  if (key && src && !opensInDocumentViewer(key) && isSignedDocLink(src)) {
    return <NativeDocumentPage src={src} documentKey={key} onBack={onBack} />;
  }
  return (
    <KnowledgeDocumentViewer
      src={src}
      documentKey={key}
      page={page}
      onBack={onBack}
    />
  );
}

/** Full-screen frame for formats the browser renders natively. The PDF
 * viewer brings its own chrome (zoom, print, download), so the strip only
 * carries the back affordance and the file name. Not sandboxed — sandbox
 * would disable the PDF viewer; the content is cross-origin (S3 presign)
 * so it gets no app privileges. */
function NativeDocumentPage({
  src,
  documentKey,
  onBack,
}: {
  src: string;
  documentKey: string;
  onBack?: () => void;
}) {
  const { page } = Route.useSearch();
  const fileName = knowledgeDocumentFileName(documentKey);
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {onBack ? (
          <TooltipIconButton
            type="button"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            label="Back"
            onClick={onBack}
            data-testid="document-view-back"
          >
            <ArrowLeft className="size-4" />
          </TooltipIconButton>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5 pl-1 text-sm">
          <FileText
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate font-medium">{fileName}</span>
          {page ? (
            <span className="shrink-0 text-muted-foreground">p.{page}</span>
          ) : null}
        </div>
      </header>
      <iframe
        title={fileName}
        src={page ? `${src}#page=${page}` : src}
        className="min-h-0 w-full flex-1 border-0"
        data-testid="document-view-frame"
      />
    </div>
  );
}
