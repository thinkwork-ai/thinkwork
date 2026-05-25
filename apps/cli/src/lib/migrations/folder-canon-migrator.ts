export type FolderCanonMode = "dry-run" | "apply" | "repair" | "noop-check";

export interface WorkspaceObjectStore {
  list(prefix: string): Promise<string[]>;
  read(key: string): Promise<string | null>;
  write(key: string, body: string): Promise<void>;
  copy(sourceKey: string, targetKey: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export interface FolderCanonMigrationOptions {
  tenantSlug?: string;
  agentSlug?: string;
  snapshotPrefix?: string;
  mode: FolderCanonMode;
  store: WorkspaceObjectStore;
  migratedDate?: string;
  cleanupLegacyFiles?: boolean;
}

export interface FolderCanonOperation {
  type: "write-agents-md" | "copy-object" | "delete-object";
  key: string;
  sourceKey?: string;
}

export interface FolderCanonAgentReport {
  tenantSlug: string;
  agentSlug: string;
  prefix: string;
  status: "dry-run" | "migrated" | "noop" | "needs-migration" | "failed";
  operations: FolderCanonOperation[];
  movedWorkspaceSlugs: string[];
  migratedFiles: string[];
  message: string;
}

export interface FolderCanonMigrationSummary {
  mode: FolderCanonMode;
  tenantReports: FolderCanonAgentReport[];
  pendingOperations: number;
}

interface LegacyFileSpec {
  filename: string;
  section: string;
}

const LEGACY_FILES: LegacyFileSpec[] = [
  { filename: "SOUL.md", section: "Personality" },
  { filename: "IDENTITY.md", section: "Identity" },
  { filename: "PLATFORM.md", section: "Platform Behavior" },
  { filename: "CAPABILITIES.md", section: "Platform Behavior" },
];

const RESERVED_TOP_LEVEL = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "GUARDRAILS.md",
  "USER.md",
  "SOUL.md",
  "IDENTITY.md",
  "PLATFORM.md",
  "CAPABILITIES.md",
  "skills",
  "memory",
  "review",
  "events",
  "errors",
  "work",
  "workspaces",
  "space",
  "spaces",
]);

export async function migrateFolderCanon(
  options: FolderCanonMigrationOptions,
): Promise<FolderCanonMigrationSummary> {
  const prefixes = await discoverAgentPrefixes(options);
  const tenantReports: FolderCanonAgentReport[] = [];

  for (const prefix of prefixes) {
    try {
      tenantReports.push(await migrateAgentPrefix(prefix, options));
    } catch (error) {
      tenantReports.push(failedReport(prefix, error));
    }
  }

  return {
    mode: options.mode,
    tenantReports,
    pendingOperations: tenantReports.reduce(
      (count, report) => count + report.operations.length,
      0,
    ),
  };
}

async function discoverAgentPrefixes(
  options: FolderCanonMigrationOptions,
): Promise<string[]> {
  if (options.snapshotPrefix) {
    return [ensureTrailingSlash(options.snapshotPrefix)];
  }
  if (options.agentSlug) {
    if (!options.tenantSlug) {
      throw new Error("--tenant is required when --agent is provided");
    }
    return [
      `tenants/${options.tenantSlug}/agents/${options.agentSlug}/workspace/`,
    ];
  }

  const tenantPrefix = options.tenantSlug
    ? `tenants/${options.tenantSlug}/agents/`
    : "tenants/";
  const keys = await options.store.list(tenantPrefix);
  const slugs = new Set<string>();
  for (const key of keys) {
    const relative = key.slice(tenantPrefix.length);
    const match = options.tenantSlug
      ? relative.match(/^([^/]+)\/workspace\//)
      : relative.match(/^([^/]+)\/agents\/([^/]+)\/workspace\//);
    const agentSlug = options.tenantSlug ? match?.[1] : match?.[2];
    if (agentSlug && agentSlug !== "_catalog") {
      slugs.add(
        options.tenantSlug
          ? `tenants/${options.tenantSlug}/agents/${agentSlug}/workspace/`
          : `tenants/${match?.[1]}/agents/${agentSlug}/workspace/`,
      );
    }
  }
  return [...slugs]
    .sort((left, right) => left.localeCompare(right))
    .map((prefix) => prefix);
}

async function migrateAgentPrefix(
  prefix: string,
  options: FolderCanonMigrationOptions,
): Promise<FolderCanonAgentReport> {
  const { tenantSlug, agentSlug } = parseWorkspacePrefix(prefix);
  const keys = await options.store.list(prefix);
  const relativePaths = keys
    .map((key) => key.slice(prefix.length))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const movedWorkspaceSlugs = discoverFlatWorkspaceSlugs(relativePaths);
  const legacyContents = await readLegacyFiles(prefix, options.store);
  const existingAgentsMd = await options.store.read(`${prefix}AGENTS.md`);
  const nextAgentsMd = buildMigratedAgentsMd({
    existingAgentsMd: existingAgentsMd ?? `# ${agentSlug} - Workspace Map\n`,
    legacyContents,
    movedWorkspaceSlugs,
    migratedDate: options.migratedDate ?? new Date().toISOString().slice(0, 10),
  });

  const operations: FolderCanonOperation[] = [];
  if (existingAgentsMd !== nextAgentsMd) {
    operations.push({ type: "write-agents-md", key: `${prefix}AGENTS.md` });
  }

  for (const path of relativePaths) {
    const slug = movedWorkspaceSlugs.find((candidate) =>
      path.startsWith(`${candidate}/`),
    );
    if (!slug) continue;
    const sourceKey = `${prefix}${path}`;
    const targetKey = `${prefix}workspaces/${path}`;
    if (keys.includes(targetKey)) {
      const [sourceContent, targetContent] = await Promise.all([
        options.store.read(sourceKey),
        options.store.read(targetKey),
      ]);
      if (sourceContent !== targetContent) {
        throw new Error(
          `Workspace collision: ${sourceKey} differs from existing ${targetKey}`,
        );
      }
    } else {
      operations.push({ type: "copy-object", sourceKey, key: targetKey });
    }
    operations.push({ type: "delete-object", key: sourceKey });
  }

  if (options.cleanupLegacyFiles) {
    for (const spec of LEGACY_FILES) {
      if (!relativePaths.includes(spec.filename)) continue;
      if (!legacyContents.has(spec.filename)) {
        operations.push({
          type: "delete-object",
          key: `${prefix}${spec.filename}`,
        });
        continue;
      }
      if (
        !hasExactMigratedBlock(
          nextAgentsMd,
          spec.filename,
          legacyContents.get(spec.filename) ?? "",
        )
      ) {
        throw new Error(
          `Refusing to delete ${prefix}${spec.filename}: AGENTS.md has no complete migrated block for the current file content`,
        );
      }
      operations.push({
        type: "delete-object",
        key: `${prefix}${spec.filename}`,
      });
    }
  }

  if (options.mode === "noop-check") {
    return {
      tenantSlug,
      agentSlug,
      prefix,
      status: operations.length > 0 ? "needs-migration" : "noop",
      operations,
      movedWorkspaceSlugs,
      migratedFiles: [...legacyContents.keys()],
      message:
        operations.length > 0
          ? `${operations.length} operation(s) pending`
          : "No migration needed",
    };
  }

  if (options.mode === "dry-run") {
    return {
      tenantSlug,
      agentSlug,
      prefix,
      status: operations.length > 0 ? "dry-run" : "noop",
      operations,
      movedWorkspaceSlugs,
      migratedFiles: [...legacyContents.keys()],
      message:
        operations.length > 0
          ? `Would apply ${operations.length} operation(s)`
          : "No migration needed",
    };
  }

  if (existingAgentsMd !== nextAgentsMd) {
    await options.store.write(`${prefix}AGENTS.md`, nextAgentsMd);
  }

  const copiedTargets: string[] = [];
  const sourceDeletes: string[] = [];
  for (const operation of operations) {
    if (operation.type === "copy-object" && operation.sourceKey) {
      await options.store.copy(operation.sourceKey, operation.key);
      copiedTargets.push(operation.key);
    } else if (operation.type === "delete-object") {
      sourceDeletes.push(operation.key);
    }
  }
  await verifyCopiedObjects(options.store, copiedTargets);
  if (sourceDeletes.length > 0) {
    await options.store.delete(sourceDeletes);
  }

  return {
    tenantSlug,
    agentSlug,
    prefix,
    status: operations.length > 0 ? "migrated" : "noop",
    operations,
    movedWorkspaceSlugs,
    migratedFiles: [...legacyContents.keys()],
    message:
      operations.length > 0
        ? `Applied ${operations.length} operation(s)`
        : "No migration needed",
  };
}

async function readLegacyFiles(
  prefix: string,
  store: WorkspaceObjectStore,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const spec of LEGACY_FILES) {
    const content = await store.read(`${prefix}${spec.filename}`);
    if (content !== null && content.trim() !== "") {
      result.set(spec.filename, content);
    }
  }
  return result;
}

function buildMigratedAgentsMd(input: {
  existingAgentsMd: string;
  legacyContents: Map<string, string>;
  movedWorkspaceSlugs: string[];
  migratedDate: string;
}): string {
  let markdown = input.existingAgentsMd;
  for (const spec of LEGACY_FILES) {
    const content = input.legacyContents.get(spec.filename);
    if (!content) continue;
    markdown = upsertMigratedSection(markdown, {
      section: spec.section,
      filename: spec.filename,
      content,
      migratedDate: input.migratedDate,
    });
  }
  return rewriteWorkspaceRouting(markdown, input.movedWorkspaceSlugs);
}

function upsertMigratedSection(
  markdown: string,
  input: {
    section: string;
    filename: string;
    content: string;
    migratedDate: string;
  },
): string {
  const marker = `<!-- migrated from ${input.filename} on ${input.migratedDate} -->`;
  const existingRange = findMigratedBlockRange(markdown, input.filename);
  if (existingRange) {
    const existingBlock = markdown.slice(
      existingRange.start,
      existingRange.end,
    );
    const existingMarkerEnd = existingBlock.indexOf("\n");
    const existingMarker =
      existingMarkerEnd === -1
        ? marker
        : existingBlock.slice(0, existingMarkerEnd);
    const block = renderMigratedBlock(
      input.filename,
      input.content,
      existingMarker,
    );
    if (existingBlock === block) return markdown;
    return (
      markdown.slice(0, existingRange.start) +
      block +
      markdown.slice(existingRange.end)
    );
  }
  const block = renderMigratedBlock(input.filename, input.content, marker);
  const range = findSectionBodyRange(markdown, input.section);
  if (!range) {
    const suffix = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${suffix}\n---\n\n## ${input.section}\n\n${block}\n`;
  }
  const body = markdown.slice(range.start, range.end).trimEnd();
  const nextBody =
    body.trim().length > 0 ? `${body}\n\n${block}\n` : `\n${block}\n`;
  return markdown.slice(0, range.start) + nextBody + markdown.slice(range.end);
}

function renderMigratedBlock(
  filename: string,
  content: string,
  openingMarker: string,
): string {
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  return `${openingMarker}\n${normalizedContent}<!-- /migrated from ${filename} -->`;
}

function hasExactMigratedBlock(
  markdown: string,
  filename: string,
  content: string,
): boolean {
  const range = findMigratedBlockRange(markdown, filename);
  if (!range) return false;
  const block = markdown.slice(range.start, range.end);
  const openingMarkerEnd = block.indexOf("\n");
  if (openingMarkerEnd === -1) return false;
  const openingMarker = block.slice(0, openingMarkerEnd);
  return block === renderMigratedBlock(filename, content, openingMarker);
}

function findMigratedBlockRange(
  markdown: string,
  filename: string,
): { start: number; end: number } | null {
  const start = markdown.indexOf(`<!-- migrated from ${filename} `);
  if (start === -1) return null;
  const closing = `<!-- /migrated from ${filename} -->`;
  const closeStart = markdown.indexOf(closing, start);
  if (closeStart === -1) return null;
  return { start, end: closeStart + closing.length };
}

function rewriteWorkspaceRouting(markdown: string, slugs: string[]): string {
  let next = markdown;
  for (const slug of slugs) {
    const escapedSlug = escapeRegex(slug);
    next = next
      .replace(
        new RegExp(`(?<!workspaces/)${escapedSlug}/CONTEXT\\.md`, "g"),
        `workspaces/${slug}/CONTEXT.md`,
      )
      .replace(
        new RegExp(`(?<!workspaces/)${escapedSlug}/AGENTS\\.md`, "g"),
        `workspaces/${slug}/AGENTS.md`,
      )
      .replace(
        new RegExp(`(\\|\\s*)${escapedSlug}/(\\s*\\|)`, "g"),
        `$1workspaces/${slug}/$2`,
      );
  }
  return next;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function discoverFlatWorkspaceSlugs(paths: string[]): string[] {
  const slugs = new Set<string>();
  for (const path of paths) {
    const flat = path.match(/^([^/.][^/]*)\/CONTEXT\.md$/);
    if (flat?.[1] && !RESERVED_TOP_LEVEL.has(flat[1])) slugs.add(flat[1]);
  }
  return [...slugs].sort((left, right) => left.localeCompare(right));
}

function failedReport(prefix: string, error: unknown): FolderCanonAgentReport {
  const { tenantSlug, agentSlug } = parseWorkspacePrefix(prefix);
  const message = error instanceof Error ? error.message : String(error);
  return {
    tenantSlug,
    agentSlug,
    prefix,
    status: "failed",
    operations: [],
    movedWorkspaceSlugs: [],
    migratedFiles: [],
    message,
  };
}

async function verifyCopiedObjects(
  store: WorkspaceObjectStore,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    if ((await store.read(key)) === null) {
      throw new Error(`Verification failed: copied object missing at ${key}`);
    }
  }
}

function findSectionBodyRange(
  markdown: string,
  sectionName: string,
): { start: number; end: number } | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(
    `(^|\\n)## ${escaped}[ \\t]*(?:\\r?\\n|$)`,
    "g",
  );
  const match = headingPattern.exec(markdown);
  if (!match) return null;

  const headingStart = match.index + (match[1] === "\n" ? 1 : 0);
  const bodyStart = headingPattern.lastIndex;
  const linePattern = /[^\n]*(?:\n|$)/g;
  linePattern.lastIndex = bodyStart;

  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = linePattern.exec(markdown))) {
    const lineStart = lineMatch.index;
    if (lineStart >= markdown.length) break;
    const line = lineMatch[0];
    const trimmed = line.trim();
    if (
      lineStart > headingStart &&
      (trimmed === "---" || line.startsWith("## "))
    ) {
      return { start: bodyStart, end: lineStart };
    }
    if (linePattern.lastIndex >= markdown.length) break;
  }

  return { start: bodyStart, end: markdown.length };
}

function parseWorkspacePrefix(prefix: string): {
  tenantSlug: string;
  agentSlug: string;
} {
  const match = ensureTrailingSlash(prefix).match(
    /^tenants\/([^/]+)\/agents\/([^/]+)\/workspace\//,
  );
  if (!match?.[1] || !match[2]) {
    return { tenantSlug: "(snapshot)", agentSlug: "(snapshot)" };
  }
  return { tenantSlug: match[1], agentSlug: match[2] };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
