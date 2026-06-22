import type {
  OkfWikiNavigatorBounds,
  OkfWikiNavigatorEntry,
  OkfWikiNavigatorLinkEntry,
  OkfWikiNavigatorLinksRequest,
  OkfWikiNavigatorLinksResult,
  OkfWikiNavigatorListRequest,
  OkfWikiNavigatorListResult,
  OkfWikiNavigatorMetadata,
  OkfWikiNavigatorProvider,
  OkfWikiNavigatorReadRequest,
  OkfWikiNavigatorReadResult,
  OkfWikiNavigatorSearchEntry,
  OkfWikiNavigatorSearchRequest,
  OkfWikiNavigatorSearchResult,
} from "@thinkwork/pi-runtime-core";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const MANIFEST_PATH = ".thinkwork/manifest.json";
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_BYTES = 64_000;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_SCAN_FILES = 1_000;
const MAX_SNIPPET_CHARS = 240;

export type OkfWikiProviderErrorCode =
  | "not_available"
  | "invalid_path"
  | "not_found"
  | "unsupported_file"
  | "binary_file"
  | "oversized_file"
  | "aborted";

export interface OkfWikiProviderOptions {
  /**
   * The mounted tenant current directory, e.g.
   * /mnt/thinkwork-okf/tenants/<tenant-slug>/current.
   */
  currentRoot: string;
  maxResults?: number;
  maxBytes?: number;
  maxDepth?: number;
  maxFileBytes?: number;
}

interface ProviderConfig {
  currentRoot: string;
  maxResults: number;
  maxBytes: number;
  maxDepth: number;
  maxFileBytes: number;
}

interface ResolvedPath {
  relativePath: string;
  absolutePath: string;
  stats: Awaited<ReturnType<typeof stat>>;
}

interface WalkState {
  entries: OkfWikiNavigatorEntry[];
  files: ResolvedPath[];
  truncated: boolean;
}

interface LinkCandidate {
  path: string;
  label?: string;
}

export class OkfWikiProviderError extends Error {
  constructor(
    message: string,
    readonly code: OkfWikiProviderErrorCode,
  ) {
    super(message);
    this.name = "OkfWikiProviderError";
  }
}

export function createOkfWikiProvider(
  options: OkfWikiProviderOptions,
): OkfWikiNavigatorProvider {
  const config = normalizeOptions(options);

  return {
    async list(
      request: OkfWikiNavigatorListRequest = {},
      signal?: AbortSignal,
    ): Promise<OkfWikiNavigatorListResult> {
      assertNotAborted(signal);
      const root = await snapshotRoot(config);
      const relativePath = normalizeOkfPath(request.path ?? ".", {
        allowRoot: true,
        allowManifest: false,
      });
      const maxResults = boundedInteger(
        request.maxResults,
        config.maxResults,
        1,
        config.maxResults,
      );
      const maxDepth = boundedInteger(
        request.maxDepth,
        config.maxDepth,
        0,
        config.maxDepth,
      );
      const target = await resolveExisting(root, relativePath);
      const state: WalkState = { entries: [], files: [], truncated: false };

      if (target.stats.isFile()) {
        assertMarkdownFile(relativePath);
        const entry = await entryForFile(target.relativePath, target, config);
        if (entry) state.entries.push(entry);
      } else if (target.stats.isDirectory()) {
        await walkDirectory({
          root,
          directory: target,
          depth: 0,
          maxDepth,
          maxResults,
          state,
          signal,
          maxFileBytes: config.maxFileBytes,
          includeFiles: true,
          includeDirectories: true,
        });
      } else {
        throw new OkfWikiProviderError(
          "OKF path is not a file or directory.",
          "unsupported_file",
        );
      }

      return {
        entries: state.entries,
        bounds: bounds({
          config,
          maxResults,
          maxDepth,
          truncated: state.truncated,
        }),
      };
    },

    async search(
      request: OkfWikiNavigatorSearchRequest,
      signal?: AbortSignal,
    ): Promise<OkfWikiNavigatorSearchResult> {
      assertNotAborted(signal);
      const query = request.query?.trim();
      if (!query) {
        throw new OkfWikiProviderError(
          "OKF wiki search requires a non-empty query.",
          "invalid_path",
        );
      }

      const root = await snapshotRoot(config);
      const relativePath = normalizeOkfPath(request.path ?? ".", {
        allowRoot: true,
        allowManifest: false,
      });
      const maxResults = boundedInteger(
        request.maxResults,
        config.maxResults,
        1,
        config.maxResults,
      );
      const maxDepth = boundedInteger(
        request.maxDepth,
        config.maxDepth,
        0,
        config.maxDepth,
      );
      const maxBytes = boundedInteger(
        request.maxBytes,
        config.maxBytes,
        1,
        config.maxBytes,
      );
      const target = await resolveExisting(root, relativePath);
      const files = await filesForSearch({
        root,
        target,
        maxDepth,
        maxResults,
        signal,
      });
      const entries: OkfWikiNavigatorSearchEntry[] = [];
      const needle = query.toLocaleLowerCase();
      let byteBudget = maxBytes;
      let truncated = files.truncated;

      for (const file of files.paths) {
        assertNotAborted(signal);
        const body = await readTextFile(file, config).catch(
          (error: unknown) => {
            if (isSkippableDiscoveredFileError(error)) return null;
            throw error;
          },
        );
        if (body === null) continue;
        const metadata = metadataForMarkdown(body);
        const lines = body.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!line.toLocaleLowerCase().includes(needle)) continue;
          const snippet = boundedSnippet(line);
          const snippetBytes = Buffer.byteLength(snippet, "utf8");
          if (entries.length >= maxResults || byteBudget <= 0) {
            truncated = true;
            break;
          }
          if (snippetBytes > byteBudget) {
            const clipped = clipUtf8(snippet, byteBudget);
            entries.push({
              path: file.relativePath,
              line: index + 1,
              snippet: clipped,
              ...metadata,
            });
            truncated = true;
            byteBudget = 0;
            break;
          }
          entries.push({
            path: file.relativePath,
            line: index + 1,
            snippet,
            ...metadata,
          });
          byteBudget -= snippetBytes;
          if (entries.length >= maxResults) {
            truncated = true;
            break;
          }
        }
        if (truncated && (entries.length >= maxResults || byteBudget <= 0)) {
          break;
        }
      }

      return {
        entries,
        bounds: bounds({ config, maxResults, maxBytes, maxDepth, truncated }),
      };
    },

    async read(
      request: OkfWikiNavigatorReadRequest,
      signal?: AbortSignal,
    ): Promise<OkfWikiNavigatorReadResult> {
      assertNotAborted(signal);
      const relativePath = normalizeOkfPath(request.path, {
        allowRoot: false,
        allowManifest: true,
      });
      assertReadableFile(relativePath);
      const root = await snapshotRoot(config);
      const target = await resolveExisting(root, relativePath);
      if (!target.stats.isFile()) {
        throw new OkfWikiProviderError(
          "OKF read target is not a file.",
          "unsupported_file",
        );
      }
      const maxBytes = boundedInteger(
        request.maxBytes,
        config.maxBytes,
        1,
        config.maxBytes,
      );
      const body = await readTextFile(target, config);
      const selection = selectReadBody(body, request, maxBytes);
      const metadata = relativePath.endsWith(".md")
        ? metadataForMarkdown(body)
        : {};

      return {
        path: relativePath,
        content: selection.content,
        offsetBytes: selection.offsetBytes,
        bytesRead: Buffer.byteLength(selection.content, "utf8"),
        ...(selection.startLine !== undefined
          ? { startLine: selection.startLine }
          : {}),
        ...(selection.endLine !== undefined
          ? { endLine: selection.endLine }
          : {}),
        truncated: selection.truncated,
        redaction: {
          source: "okf_navigator",
          policy: "cite_or_summarize_only",
        },
        ...metadata,
      };
    },

    async links(
      request: OkfWikiNavigatorLinksRequest,
      signal?: AbortSignal,
    ): Promise<OkfWikiNavigatorLinksResult> {
      assertNotAborted(signal);
      const relativePath = normalizeOkfPath(request.path, {
        allowRoot: false,
        allowManifest: false,
      });
      assertMarkdownFile(relativePath);
      const root = await snapshotRoot(config);
      const target = await resolveExisting(root, relativePath);
      if (!target.stats.isFile()) {
        throw new OkfWikiProviderError(
          "OKF links target is not a file.",
          "unsupported_file",
        );
      }
      const maxResults = boundedInteger(
        request.maxResults,
        config.maxResults,
        1,
        config.maxResults,
      );
      const body = await readTextFile(target, config);
      const links: OkfWikiNavigatorLinkEntry[] = [];
      let truncated = false;
      for (const candidate of extractMarkdownLinks(body, relativePath)) {
        assertNotAborted(signal);
        const entry = await linkEntryForCandidate(root, candidate, config);
        if (!entry) continue;
        links.push(entry);
        if (links.length >= maxResults) {
          truncated = true;
          break;
        }
      }

      const backlinks: OkfWikiNavigatorLinkEntry[] = [];
      if (request.includeBacklinks === true && links.length < maxResults) {
        const remaining = maxResults - links.length;
        const files = await collectMarkdownFiles({
          root,
          target: await resolveExisting(root, "."),
          maxDepth: config.maxDepth,
          maxResults: config.maxResults,
          signal,
        });
        truncated = truncated || files.truncated;
        for (const file of files.paths) {
          if (file.relativePath === relativePath) continue;
          const fileBody = await readTextFile(file, config).catch(
            (error: unknown) => {
              if (isSkippableDiscoveredFileError(error)) return null;
              throw error;
            },
          );
          if (fileBody === null) continue;
          const pointsHere = extractMarkdownLinks(
            fileBody,
            file.relativePath,
          ).some((candidate) => candidate.path === relativePath);
          if (!pointsHere) continue;
          backlinks.push({
            path: file.relativePath,
            ...metadataForMarkdown(fileBody),
          });
          if (backlinks.length >= remaining) {
            truncated = true;
            break;
          }
        }
      }

      return {
        path: relativePath,
        links,
        backlinks,
        bounds: bounds({ config, maxResults, truncated }),
      };
    },
  };
}

function normalizeOptions(options: OkfWikiProviderOptions): ProviderConfig {
  if (!options.currentRoot?.trim()) {
    throw new OkfWikiProviderError(
      "OKF wiki provider constructed without a current root.",
      "not_available",
    );
  }
  return {
    currentRoot: options.currentRoot,
    maxResults: boundedInteger(options.maxResults, DEFAULT_MAX_RESULTS, 1, 250),
    maxBytes: boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1, 512_000),
    maxDepth: boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 0, 16),
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      1,
      8_000_000,
    ),
  };
}

async function snapshotRoot(config: ProviderConfig): Promise<string> {
  let root: string;
  try {
    root = await realpath(config.currentRoot);
  } catch {
    throw new OkfWikiProviderError(
      "OKF wiki current root is not available.",
      "not_available",
    );
  }
  const rootStats = await stat(root).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new OkfWikiProviderError(
      "OKF wiki current root is not a directory.",
      "not_available",
    );
  }
  return root;
}

function normalizeOkfPath(
  value: string | undefined,
  options: { allowRoot: boolean; allowManifest: boolean },
): string {
  if (typeof value !== "string") {
    throw new OkfWikiProviderError(
      "OKF path must be a string.",
      "invalid_path",
    );
  }
  const trimmed = value.trim();
  if (trimmed !== value || trimmed.length === 0) {
    throw new OkfWikiProviderError(
      "OKF path must be a non-empty trimmed string.",
      "invalid_path",
    );
  }
  if (trimmed === ".") {
    if (options.allowRoot) return ".";
    throw new OkfWikiProviderError(
      "OKF path must name a file.",
      "invalid_path",
    );
  }
  if (
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.includes("//")
  ) {
    throw new OkfWikiProviderError(
      "OKF path must be a normalized bundle-relative path.",
      "invalid_path",
    );
  }
  const rawSegments = trimmed.split("/");
  for (const segment of rawSegments) {
    if (!segment || segment === "." || segment === "..") {
      throw new OkfWikiProviderError(
        "OKF path contains an unsafe segment.",
        "invalid_path",
      );
    }
    if (segment.startsWith(".")) {
      const isManifest = options.allowManifest && trimmed === MANIFEST_PATH;
      if (!isManifest) {
        throw new OkfWikiProviderError(
          "OKF path references a hidden file or directory.",
          "invalid_path",
        );
      }
    }
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized.startsWith("../")) {
    throw new OkfWikiProviderError(
      "OKF path escapes the bundle root.",
      "invalid_path",
    );
  }
  return normalized;
}

async function resolveExisting(
  root: string,
  relativePath: string,
): Promise<ResolvedPath> {
  const absoluteCandidate = path.resolve(
    root,
    relativePath === "." ? "" : relativePath,
  );
  if (!isWithin(root, absoluteCandidate)) {
    throw new OkfWikiProviderError(
      "OKF path escapes the bundle root.",
      "invalid_path",
    );
  }
  await assertNoSymlinkSegments(root, relativePath);

  let absolutePath: string;
  try {
    absolutePath = await realpath(absoluteCandidate);
  } catch {
    throw new OkfWikiProviderError("OKF path was not found.", "not_found");
  }
  if (!isWithin(root, absolutePath)) {
    throw new OkfWikiProviderError(
      "OKF path escapes the bundle root.",
      "invalid_path",
    );
  }

  const stats = await stat(absolutePath);
  return { relativePath, absolutePath, stats };
}

async function walkDirectory(args: {
  root: string;
  directory: ResolvedPath;
  depth: number;
  maxDepth: number;
  maxResults: number;
  state: WalkState;
  signal?: AbortSignal;
  maxFileBytes: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}): Promise<void> {
  if (args.depth > args.maxDepth) {
    args.state.truncated = true;
    return;
  }
  const entries = await readdir(args.directory.absolutePath, {
    withFileTypes: true,
  });
  for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    assertNotAborted(args.signal);
    const countForLimit =
      args.includeFiles || args.includeDirectories
        ? args.state.entries.length
        : args.state.files.length;
    if (countForLimit >= args.maxResults) {
      args.state.truncated = true;
      return;
    }
    if (dirent.name.startsWith(".")) continue;
    const childRelativePath =
      args.directory.relativePath === "."
        ? dirent.name
        : `${args.directory.relativePath}/${dirent.name}`;
    const normalized = normalizeOkfPath(childRelativePath, {
      allowRoot: false,
      allowManifest: false,
    });
    const child = await resolveExisting(args.root, normalized);

    if (child.stats.isDirectory()) {
      if (args.includeDirectories) {
        args.state.entries.push({
          path: child.relativePath,
          kind: "directory",
        });
      }
      await walkDirectory({
        ...args,
        directory: child,
        depth: args.depth + 1,
      });
    } else if (child.stats.isFile() && isMarkdownPath(child.relativePath)) {
      if (args.includeFiles) {
        const entry = await entryForFile(child.relativePath, child, {
          maxFileBytes: args.maxFileBytes,
        }).catch((error: unknown) => {
          if (isSkippableDiscoveredFileError(error)) return null;
          throw error;
        });
        if (entry) args.state.entries.push(entry);
      }
      args.state.files.push(child);
    }
  }
}

async function filesForSearch(args: {
  root: string;
  target: ResolvedPath;
  maxDepth: number;
  maxResults: number;
  signal?: AbortSignal;
}): Promise<{ paths: ResolvedPath[]; truncated: boolean }> {
  if (args.target.stats.isFile()) {
    assertMarkdownFile(args.target.relativePath);
    return { paths: [args.target], truncated: false };
  }
  if (!args.target.stats.isDirectory()) {
    throw new OkfWikiProviderError(
      "OKF search target is not a file or directory.",
      "unsupported_file",
    );
  }
  return collectMarkdownFiles(args);
}

async function collectMarkdownFiles(args: {
  root: string;
  target: ResolvedPath;
  maxDepth: number;
  maxResults: number;
  signal?: AbortSignal;
}): Promise<{ paths: ResolvedPath[]; truncated: boolean }> {
  const state: WalkState = { entries: [], files: [], truncated: false };
  await walkDirectory({
    root: args.root,
    directory: args.target,
    depth: 0,
    maxDepth: args.maxDepth,
    maxResults: DEFAULT_MAX_SCAN_FILES,
    state,
    signal: args.signal,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    includeFiles: false,
    includeDirectories: false,
  });
  return {
    paths: state.files.sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    ),
    truncated: state.truncated,
  };
}

async function entryForFile(
  relativePath: string,
  target: ResolvedPath,
  config: Pick<ProviderConfig, "maxFileBytes">,
): Promise<OkfWikiNavigatorEntry | null> {
  const body = await readTextFile(target, config);
  return {
    path: relativePath,
    kind: "file",
    sizeBytes: fileSize(target),
    ...metadataForMarkdown(body),
  };
}

async function readTextFile(
  target: ResolvedPath,
  config: Pick<ProviderConfig, "maxFileBytes">,
): Promise<string> {
  if (fileSize(target) > config.maxFileBytes) {
    throw new OkfWikiProviderError(
      "OKF file exceeds the configured read limit.",
      "oversized_file",
    );
  }
  const buffer = await readFile(target.absolutePath);
  if (isBinary(buffer)) {
    throw new OkfWikiProviderError(
      "OKF file is binary and cannot be returned as source data.",
      "binary_file",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new OkfWikiProviderError(
      "OKF file is binary and cannot be returned as source data.",
      "binary_file",
    );
  }
}

function selectReadBody(
  body: string,
  request: OkfWikiNavigatorReadRequest,
  maxBytes: number,
): {
  content: string;
  offsetBytes: number;
  startLine?: number;
  endLine?: number;
  truncated: boolean;
} {
  if (request.startLine !== undefined || request.endLine !== undefined) {
    const lines = body.split(/\r?\n/);
    const startLine = boundedInteger(
      request.startLine,
      1,
      1,
      lines.length || 1,
    );
    const endLine = boundedInteger(
      request.endLine,
      lines.length,
      startLine,
      lines.length || startLine,
    );
    const prefix =
      startLine <= 1 ? "" : `${lines.slice(0, startLine - 1).join("\n")}\n`;
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const clipped = clipUtf8(selected, maxBytes);
    return {
      content: clipped,
      offsetBytes: Buffer.byteLength(prefix, "utf8"),
      startLine,
      endLine,
      truncated: Buffer.byteLength(selected, "utf8") > maxBytes,
    };
  }

  const buffer = Buffer.from(body, "utf8");
  const offsetBytes = boundedInteger(
    request.offsetBytes,
    0,
    0,
    buffer.byteLength,
  );
  return sliceUtf8ByByteRange(body, offsetBytes, maxBytes);
}

function extractMarkdownLinks(body: string, fromPath: string): LinkCandidate[] {
  const links: LinkCandidate[] = [];
  const regex = /(^|[^!])\[([^\]\n]{1,200})\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(regex)) {
    const label = match[2]?.trim();
    const href = match[3]?.trim();
    if (!href) continue;
    const target = resolveMarkdownHref(fromPath, href);
    if (!target) continue;
    links.push({ path: target, ...(label ? { label } : {}) });
  }
  return dedupeLinks(links);
}

function resolveMarkdownHref(fromPath: string, href: string): string | null {
  const withoutAnchor = href.split("#", 1)[0]?.trim() ?? "";
  if (
    !withoutAnchor ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(withoutAnchor) ||
    withoutAnchor.startsWith("//")
  ) {
    return null;
  }
  const target = withoutAnchor.startsWith("/")
    ? withoutAnchor.slice(1)
    : path.posix.join(path.posix.dirname(fromPath), withoutAnchor);
  try {
    const normalized = normalizeOkfPath(target, {
      allowRoot: false,
      allowManifest: false,
    });
    return isMarkdownPath(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function linkEntryForCandidate(
  root: string,
  candidate: LinkCandidate,
  config: Pick<ProviderConfig, "maxFileBytes">,
): Promise<OkfWikiNavigatorLinkEntry | null> {
  let target: ResolvedPath;
  try {
    target = await resolveExisting(root, candidate.path);
  } catch {
    return null;
  }
  if (!target.stats.isFile() || !isMarkdownPath(target.relativePath)) {
    return null;
  }
  const body = await readTextFile(target, {
    maxFileBytes: config.maxFileBytes,
  }).catch((error: unknown) => {
    if (isSkippableDiscoveredFileError(error)) return null;
    throw error;
  });
  if (body === null) return null;
  return {
    path: target.relativePath,
    ...(candidate.label ? { label: candidate.label } : {}),
    ...metadataForMarkdown(body),
  };
}

function isSkippableDiscoveredFileError(error: unknown): boolean {
  return (
    error instanceof OkfWikiProviderError &&
    (error.code === "binary_file" || error.code === "oversized_file")
  );
}

function metadataForMarkdown(body: string): OkfWikiNavigatorMetadata {
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const block = frontmatter?.[1] ?? "";
  const title =
    scalarFromYaml(block, "title") ?? firstHeading(body) ?? undefined;
  const type = scalarFromYaml(block, "type");
  const pageKind = scalarFromYaml(block, "page_kind");
  return {
    ...(title ? { title } : {}),
    ...(type ? { type } : {}),
    ...(pageKind ? { pageKind } : {}),
  };
}

function scalarFromYaml(block: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m");
  const value = block.match(pattern)?.[1]?.trim();
  if (!value || value === "null") return undefined;
  return unquoteYamlScalar(value);
}

function firstHeading(body: string): string | undefined {
  return body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
  }
  return value;
}

function assertReadableFile(relativePath: string): void {
  if (relativePath === MANIFEST_PATH) return;
  assertMarkdownFile(relativePath);
}

function assertMarkdownFile(relativePath: string): void {
  if (!isMarkdownPath(relativePath)) {
    throw new OkfWikiProviderError(
      "OKF path must point to a markdown file.",
      "unsupported_file",
    );
  }
}

function isMarkdownPath(relativePath: string): boolean {
  return relativePath.endsWith(".md");
}

function fileSize(target: ResolvedPath): number {
  return Number(target.stats.size);
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  if (buffer.length === 0) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / buffer.length > 0.02;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OkfWikiProviderError(
      `OKF bound must be an integer between ${min} and ${max}.`,
      "invalid_path",
    );
  }
  return value;
}

function bounds(args: {
  config: ProviderConfig;
  maxResults?: number;
  maxBytes?: number;
  maxDepth?: number;
  truncated: boolean;
}): OkfWikiNavigatorBounds {
  return {
    maxResults: args.maxResults ?? args.config.maxResults,
    maxBytes: args.maxBytes ?? args.config.maxBytes,
    maxDepth: args.maxDepth ?? args.config.maxDepth,
    truncated: args.truncated,
  };
}

function boundedSnippet(line: string): string {
  const compact = line.trim().replace(/\s+/g, " ");
  return compact.length > MAX_SNIPPET_CHARS
    ? `${compact.slice(0, MAX_SNIPPET_CHARS - 3)}...`
    : compact;
}

function clipUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let clipped = "";
  let usedBytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + charBytes > maxBytes) break;
    clipped += char;
    usedBytes += charBytes;
  }
  return clipped;
}

function sliceUtf8ByByteRange(
  value: string,
  offsetBytes: number,
  maxBytes: number,
): { content: string; offsetBytes: number; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  let start = Math.min(offsetBytes, buffer.byteLength);
  while (start < buffer.byteLength && isUtf8ContinuationByte(buffer[start]!)) {
    start += 1;
  }
  const content = clipUtf8(buffer.subarray(start).toString("utf8"), maxBytes);
  const bytesRead = Buffer.byteLength(content, "utf8");
  return {
    content,
    offsetBytes: start,
    truncated: start + bytesRead < buffer.byteLength,
  };
}

async function assertNoSymlinkSegments(
  root: string,
  relativePath: string,
): Promise<void> {
  if (relativePath === ".") return;
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => null);
    if (stats === null) {
      throw new OkfWikiProviderError("OKF path was not found.", "not_found");
    }
    if (stats.isSymbolicLink()) {
      throw new OkfWikiProviderError(
        "OKF path references a symbolic link.",
        "invalid_path",
      );
    }
  }
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function dedupeLinks(links: LinkCandidate[]): LinkCandidate[] {
  const seen = new Set<string>();
  const unique: LinkCandidate[] = [];
  for (const link of links) {
    const key = `${link.path}\0${link.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OkfWikiProviderError(
      "OKF wiki provider call was aborted.",
      "aborted",
    );
  }
}
