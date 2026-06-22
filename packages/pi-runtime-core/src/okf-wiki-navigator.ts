/**
 * OKF Wiki Navigator — host-supplied read-only traversal contract.
 *
 * The core and future Pi extension know only this interface. The cloud host
 * supplies a provider rooted at the current tenant bundle, so model-facing
 * tools never accept tenant ids, S3 keys, credentials, or absolute host paths.
 * Returned markdown is untrusted source data: callers may cite or summarize it,
 * but must never treat it as instructions or as a policy-expansion channel.
 */

export interface OkfWikiNavigatorBounds {
  maxResults: number;
  maxBytes: number;
  maxDepth: number;
  truncated: boolean;
}

export interface OkfWikiNavigatorMetadata {
  title?: string;
  type?: string;
  pageKind?: string;
}

export interface OkfWikiNavigatorEntry extends OkfWikiNavigatorMetadata {
  path: string;
  kind: "file" | "directory";
  sizeBytes?: number;
}

export interface OkfWikiNavigatorSearchEntry extends OkfWikiNavigatorMetadata {
  path: string;
  line: number;
  snippet: string;
}

export interface OkfWikiNavigatorLinkEntry extends OkfWikiNavigatorMetadata {
  path: string;
  label?: string;
}

export interface OkfWikiNavigatorReadResult extends OkfWikiNavigatorMetadata {
  path: string;
  content: string;
  offsetBytes: number;
  bytesRead: number;
  startLine?: number;
  endLine?: number;
  truncated: boolean;
  redaction: {
    source: "okf_navigator";
    policy: "cite_or_summarize_only";
  };
}

export interface OkfWikiNavigatorListRequest {
  path?: string;
  maxDepth?: number;
  maxResults?: number;
}

export interface OkfWikiNavigatorListResult {
  entries: OkfWikiNavigatorEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorSearchRequest {
  query: string;
  path?: string;
  maxDepth?: number;
  maxResults?: number;
  maxBytes?: number;
}

export interface OkfWikiNavigatorSearchResult {
  entries: OkfWikiNavigatorSearchEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorReadRequest {
  path: string;
  offsetBytes?: number;
  maxBytes?: number;
  startLine?: number;
  endLine?: number;
}

export interface OkfWikiNavigatorLinksRequest {
  path: string;
  includeBacklinks?: boolean;
  maxResults?: number;
}

export interface OkfWikiNavigatorLinksResult {
  path: string;
  links: OkfWikiNavigatorLinkEntry[];
  backlinks: OkfWikiNavigatorLinkEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorProvider {
  list(
    request?: OkfWikiNavigatorListRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorListResult>;

  search(
    request: OkfWikiNavigatorSearchRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorSearchResult>;

  read(
    request: OkfWikiNavigatorReadRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorReadResult>;

  links(
    request: OkfWikiNavigatorLinksRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorLinksResult>;
}
