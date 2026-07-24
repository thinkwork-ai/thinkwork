/**
 * Pure planning logic for s3-connect Knowledge Base sources (external S3 KB
 * source U2).
 *
 * Bedrock's S3 data source connector has no exclusion filters (its
 * S3DataSourceConfiguration is bucketArn + bucketOwnerAccountId + a single
 * inclusionPrefix), so s3-connect sources are provisioned as CUSTOM data
 * sources and synced by platform-driven direct ingestion instead of the S3
 * crawler: the manager lists the customer bucket in place, applies the
 * source's include/exclude globs here, then Ingest/DeleteKnowledgeBaseDocuments
 * the delta. Content is still read from the customer's bucket by Bedrock at
 * ingest time (sourceType S3_LOCATION) — nothing is copied.
 *
 * Exclusion wins over inclusion, matching the Bedrock filter semantics the
 * operator surface documents (R4).
 */

/** `{include, exclude}` glob arrays stored on knowledge_base_sources.filter_patterns. */
export interface SourceFilterPatterns {
  include?: string[];
  exclude?: string[];
}

/** Bedrock's standard parser skips files over ~50MB; count them explicitly
 * rather than letting them vanish (connect report requirement). */
export const MAX_DIRECT_INGEST_BYTES = 49 * 1024 * 1024;

/** Direct ingestion accepts at most 10 documents per request. */
export const DIRECT_INGEST_BATCH_SIZE = 10;

/**
 * Compile one glob to a RegExp over the full S3 key. `*` matches any run of
 * characters INCLUDING `/` (so `*Retired Procedures/*` matches at any depth);
 * `?` matches one character. Everything else is literal.
 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`);
}

/**
 * Does a key survive the source's filters? Empty/missing include list means
 * include-everything; any matching exclude wins over any include.
 */
export function keyMatchesFilters(
  key: string,
  patterns: SourceFilterPatterns | null | undefined,
): boolean {
  const include = patterns?.include ?? [];
  const exclude = patterns?.exclude ?? [];
  for (const glob of exclude) {
    if (globToRegExp(glob).test(key)) return false;
  }
  if (include.length === 0) return true;
  return include.some((glob) => globToRegExp(glob).test(key));
}

/** One live object listed from the connected bucket. */
export interface LiveObject {
  key: string;
  /** ETag with quotes stripped. */
  etag: string | null;
  sizeBytes: number;
}

/** The subset of a manifest row the planner needs. */
export interface ManifestEntry {
  document_key: string;
  etag: string | null;
  ingest_status: string;
}

export interface DirectIngestionPlan {
  /** New or content-changed keys to Ingest (filtered, within size cap). */
  toIngest: LiveObject[];
  /** Manifest keys to DeleteKnowledgeBaseDocuments: removed from the bucket,
   * or now matching an exclusion (e.g. moved under Retired Procedures/). */
  toDelete: string[];
  /** Keys skipped for exceeding the standard-parser ceiling. */
  skippedOversize: string[];
  /** Keys excluded by filter patterns (visibility for the connect report). */
  excluded: string[];
}

/**
 * Diff the filtered live listing against the manifest for this data source.
 * Deletion is driven by the filtered view: a document that still exists in
 * S3 but now matches an exclusion is deleted from the index (R12/AE1) with
 * no retrievability window.
 */
export function planDirectIngestion(args: {
  liveObjects: LiveObject[];
  manifest: ManifestEntry[];
  patterns: SourceFilterPatterns | null | undefined;
  maxFileBytes?: number;
}): DirectIngestionPlan {
  const maxBytes = args.maxFileBytes ?? MAX_DIRECT_INGEST_BYTES;
  const toIngest: LiveObject[] = [];
  const skippedOversize: string[] = [];
  const excluded: string[] = [];
  const surviving = new Set<string>();

  const manifestByKey = new Map(
    args.manifest.map((row) => [row.document_key, row]),
  );

  for (const object of args.liveObjects) {
    if (!keyMatchesFilters(object.key, args.patterns)) {
      excluded.push(object.key);
      continue;
    }
    if (object.sizeBytes > maxBytes) {
      skippedOversize.push(object.key);
      continue;
    }
    surviving.add(object.key);
    const row = manifestByKey.get(object.key);
    const changed =
      !row ||
      row.etag === null ||
      object.etag === null ||
      row.etag !== object.etag ||
      row.ingest_status === "failed" ||
      row.ingest_status === "pending";
    if (changed) toIngest.push(object);
  }

  const toDelete: string[] = [];
  for (const row of args.manifest) {
    if (surviving.has(row.document_key)) continue;
    if (row.ingest_status === "absent_verified") continue;
    toDelete.push(row.document_key);
  }

  return { toIngest, toDelete, skippedOversize, excluded };
}

/** Chunk a list into direct-ingestion batches. */
export function batch<T>(items: T[], size = DIRECT_INGEST_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
