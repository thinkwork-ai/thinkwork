/**
 * Pure logic for the kb-transcribe preprocessor (KB page transcription U2).
 *
 * Bedrock's default parser "only parses text in text files": a scanned page
 * indexes as nothing, and a screenshot-driven SOP indexes only its caption
 * lines. The preprocessor splits each PDF page, transcribes image-bearing
 * pages with a Claude vision model, and writes one markdown file per page
 * plus a report. The manager then ingests one IN_LINE document per page.
 *
 * Two design decisions are load-bearing and were both settled by measurement,
 * not preference:
 *
 *  1. Routing is DETERMINISTIC (characters and images per page), never an OCR
 *     confidence score. Docling graded an unusable transcription of the
 *     representative document `FAIR`, so a confidence gate would not have
 *     fired on the very page that needed it most.
 *
 *  2. Model selection walks a configured LADDER and records what actually
 *     ran. Model availability is per-account: on the McPherson account the
 *     Opus tiers return AccessDeniedException while Sonnet 4.6 works. A
 *     hard-pinned model would have failed on day one.
 */

/** Bump when the pipeline changes in a way that invalidates prior output.
 * Joins the change-detection predicate, so a bump forces reprocessing even
 * when the S3 etag is unchanged. */
export const PREPROCESSOR_VERSION = "1";

/** How one page's text was obtained. */
export type PageRoute = "native" | "transcribed";

export interface PageResult {
  /** 1-based page number, matching PDF page numbering and `#page=` deep links. */
  page: number;
  route: PageRoute;
  /** Bedrock model id that produced a transcription; null for native text. */
  model: string | null;
  /** Characters extracted natively from the page's text layer. */
  nativeChars: number;
  /** Embedded image XObjects on the page. */
  imageCount: number;
  /** Characters in the final page markdown. */
  chars: number;
  /** True when the page produced too little text to be useful — indexed with
   * a warning rather than dropped, so a bad page is visible, not invisible. */
  lowSignal: boolean;
  /** Transcription failure, if any. The page still ingests with whatever
   * native text exists so a model outage never silently loses a page. */
  error?: string;
}

export interface TranscribeReport {
  preprocessorVersion: string;
  /** S3 key of the source document. */
  documentKey: string;
  /** S3 etag of the exact bytes transcribed. */
  etag: string | null;
  pageCount: number;
  pages: PageResult[];
  /** True when any page is lowSignal. */
  needsReview: boolean;
  /** Total Bedrock tokens spent, for cost attribution. */
  inputTokens: number;
  outputTokens: number;
  completedAt: string;
}

/**
 * A page with real text and no images has nothing an image model can add —
 * native extraction is exact and free. Below this, a page is worth looking at.
 */
export const NATIVE_TEXT_CHAR_THRESHOLD = 400;

/**
 * Final page markdown shorter than this means the page yielded almost
 * nothing: a blank scan, a failed transcription, or an image the model
 * declined to read. Flag it for review.
 */
export const LOW_SIGNAL_CHAR_THRESHOLD = 40;

/**
 * Decide how to get a page's text.
 *
 * Any embedded image means the page may carry substance the text layer does
 * not — that is the dominant case in a Scribe-style SOP, where the caption
 * extracts natively but the screenshot beside it is the actual instruction.
 * A page with no images and plenty of text is taken as-is.
 */
export function routePage(args: {
  nativeChars: number;
  imageCount: number;
}): PageRoute {
  if (args.imageCount > 0) return "transcribed";
  if (args.nativeChars >= NATIVE_TEXT_CHAR_THRESHOLD) return "native";
  return "transcribed";
}

/**
 * Strip ASCII control characters. Bedrock inline ingestion fails SILENTLY on
 * these — the document lands in FAILED with an empty statusReason — and
 * upstream converters emit them routinely (python-pptx uses \x0B for soft
 * line breaks). Tabs, newlines and carriage returns are preserved.
 */
export function sanitizeForInlineIngestion(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Where a document's preprocessor output lives in the workspace bucket.
 * Keyed by etag and pipeline version so a changed document or a bumped
 * pipeline writes to a fresh prefix and never reads stale pages.
 */
export function derivedPrefix(args: {
  tenantSlug: string;
  knowledgeBaseId: string;
  documentKey: string;
  etag: string | null;
  preprocessorVersion?: string;
}): string {
  const version = args.preprocessorVersion ?? PREPROCESSOR_VERSION;
  const slot = `${args.etag ?? "noetag"}-v${version}`;
  return (
    `tenants/${args.tenantSlug}/knowledge-bases/${args.knowledgeBaseId}` +
    `/derived/${encodeDocumentKey(args.documentKey)}/${slot}`
  );
}

/**
 * S3 keys carry spaces, `#`, and other characters that would collide with the
 * page-document id syntax. Encode to a flat, filesystem-safe token that is
 * stable across runs (no hashing — the key stays legible in the bucket).
 */
export function encodeDocumentKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
}

/** Page-document id ingested into Bedrock: '<s3 key>#p=<n>'. */
export function pageDocumentId(documentKey: string, page: number): string {
  return `${documentKey}#p=${page}`;
}

/**
 * Recover the source document key from a page-document id. Page documents are
 * an ingestion-level fan-out — the manifest, presigned-URL lookup, and
 * citation surface all key on the base document.
 */
export function baseDocumentKey(id: string): string {
  const match = /^(.*)#p=\d+$/.exec(id);
  return match ? match[1] : id;
}

/** Page number encoded in a page-document id, or null for a base key. */
export function pageNumberFromId(id: string): number | null {
  const match = /#p=(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * Fold per-page Bedrock statuses up to one status per source document. The
 * manifest holds ONE row per document; a document is only as healthy as its
 * worst page, and a document still moving is not yet terminal.
 */
export function foldPageStatuses(
  statusById: Map<string, string>,
): Map<string, string> {
  const byDocument = new Map<string, string[]>();
  for (const [id, status] of statusById) {
    const key = baseDocumentKey(id);
    const list = byDocument.get(key);
    if (list) list.push(status);
    else byDocument.set(key, [status]);
  }

  const IN_FLIGHT = new Set([
    "STARTING",
    "PENDING",
    "IN_PROGRESS",
    "DELETING",
    "DELETE_IN_PROGRESS",
  ]);

  const folded = new Map<string, string>();
  for (const [key, statuses] of byDocument) {
    // Failure is the most important signal, then "not settled yet", and only
    // then success — otherwise one INDEXED page would mask a FAILED sibling.
    const failed = statuses.find((status) => status === "FAILED");
    const inFlight = statuses.find((status) => IN_FLIGHT.has(status));
    folded.set(key, failed ?? inFlight ?? statuses[0]);
  }
  return folded;
}

/**
 * The document header prepended to every page's indexed text. A retrieved
 * chunk is read without its neighbours, so the page has to say what document
 * and page it came from or the model cannot cite it.
 */
export function pageDocumentHeader(args: {
  title: string;
  page: number;
  pageCount: number;
  transcribed: boolean;
}): string {
  const provenance = args.transcribed
    ? "\n> This page was transcribed from a scanned image or screenshot.\n"
    : "";
  return `# ${args.title}\n\n_Page ${args.page} of ${args.pageCount}_\n${provenance}\n`;
}
