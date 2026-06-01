import { parse as parseYaml } from "yaml";

export type MentionableWorkspaces =
  | { mode: "all"; slugs: string[] }
  | { mode: "none"; slugs: string[] }
  | { mode: "allowlist"; slugs: string[] };

export type SpaceManifestDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
};

export type SpaceManifestWorkflow = {
  key: string;
  name: string;
  description: string | null;
  source: "frontmatter" | "markdown";
};

export type SpaceManifestTools = {
  builtIn: string[];
  mcp: string[];
};

export type SpaceManifestReviewPolicy = {
  mode: "none" | "optional" | "required" | "unknown";
  notes: string | null;
};

export type SpaceManifestRuntimePolicy = {
  bash: "default" | "disabled" | "read-only" | "restricted" | "enabled";
  model: string | null;
  sandbox: boolean | null;
};

export type SpaceManifest = {
  version: 1;
  frontmatterPresent: boolean;
  descriptiveFrontmatter: {
    name: string | null;
    description: string | null;
  };
  title: string | null;
  summary: string | null;
  description: string | null;
  workflows: SpaceManifestWorkflow[];
  tools: SpaceManifestTools;
  skills: string[];
  runtimePolicy: SpaceManifestRuntimePolicy;
  reviewPolicy: SpaceManifestReviewPolicy;
  mentionableWorkspaces: MentionableWorkspaces;
  sections: Array<{ heading: string; body: string }>;
  diagnostics: SpaceManifestDiagnostic[];
  pendingFields: string[];
};

export type SpaceManifestProjection = {
  manifest: SpaceManifest;
  autoApply: {
    name?: string;
    description?: string | null;
  };
  configPatch: {
    spaceManifest: Omit<SpaceManifest, "diagnostics"> & {
      diagnosticCounts: Record<SpaceManifestDiagnostic["severity"], number>;
    };
  };
  renderDiagnostics: {
    spaceManifest: {
      status: "ok" | "warning" | "error";
      diagnostics: SpaceManifestDiagnostic[];
      pendingFields: string[];
      appliedFields: string[];
      workflowCount: number;
      builtInToolCount: number;
      mcpToolCount: number;
      skillCount: number;
    };
  };
};

const MENTIONABLE_WORKSPACES_HEADING = /^##\s+Mentionable\s+Workspaces\s*$/i;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SECURITY_FIELD_PATHS = [
  "tools",
  "mcp",
  "mcp_servers",
  "runtime",
  "bash",
  "policy",
  "review_policy",
  "review",
  "agent_availability",
  "guardrails",
];

function normalizeSlug(line: string): string | null {
  const stripped = line.replace(/<!--.*?-->/g, "").trim();
  if (!stripped || stripped.startsWith("#")) return null;
  const normalized = stripped
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

export function parseMentionableWorkspaces(
  spaceMdContent: string,
): MentionableWorkspaces {
  const lines = spaceMdContent.replace(/\r\n?/g, "\n").split("\n");
  const headingIndex = lines.findIndex((line) =>
    MENTIONABLE_WORKSPACES_HEADING.test(line.trim()),
  );
  if (headingIndex === -1) return { mode: "all", slugs: [] };

  const sectionEnd = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+/.test(line.trim()),
  );
  const sectionLines = lines.slice(
    headingIndex + 1,
    sectionEnd === -1 ? undefined : sectionEnd,
  );
  const fenceStart = sectionLines.findIndex((line) => /^```/.test(line.trim()));
  if (fenceStart === -1) return { mode: "none", slugs: [] };

  const fenceEnd = sectionLines.findIndex(
    (line, index) => index > fenceStart && /^```/.test(line.trim()),
  );
  const fencedLines = sectionLines.slice(
    fenceStart + 1,
    fenceEnd === -1 ? undefined : fenceEnd,
  );
  const slugs = Array.from(
    new Set(
      fencedLines
        .map(normalizeSlug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ).sort();

  return slugs.length > 0
    ? { mode: "allowlist", slugs }
    : { mode: "none", slugs: [] };
}

export function parseSpaceManifest(spaceMdContent: string): SpaceManifest {
  const normalized = spaceMdContent.replace(/\r\n?/g, "\n");
  const diagnostics: SpaceManifestDiagnostic[] = [];
  const { frontmatterPresent, frontmatter, body } =
    splitSpaceFrontmatter(normalized);
  const data = parseFrontmatter(frontmatter, diagnostics);
  const sections = parseSections(body);
  const frontmatterName = stringValue(data.name);
  const frontmatterDescription =
    stringValue(data.description) ?? stringValue(data.summary);
  const title = frontmatterName ?? firstHeading(body);
  const description = frontmatterDescription ?? firstParagraph(body);
  const workflows = [
    ...workflowsFromFrontmatter(data.workflows, diagnostics),
    ...workflowsFromSection(
      sections.find((s) => /^workflows?$/i.test(s.heading)),
    ),
  ];
  const tools = toolsFromFrontmatter(data);
  const skills = stringList(data.skills);
  const runtimePolicy = runtimePolicyFromFrontmatter(data, diagnostics);
  const reviewPolicy = reviewPolicyFromFrontmatter(data);
  const pendingFields = pendingBehaviorFields(data);

  for (const field of pendingFields) {
    diagnostics.push({
      severity: "warning",
      code: "SpaceManifestPendingApply",
      path: field,
      message: `${field} is parsed for review, but does not automatically change runtime policy in v1.`,
    });
  }

  return {
    version: 1,
    frontmatterPresent,
    descriptiveFrontmatter: {
      name: frontmatterName,
      description: frontmatterDescription,
    },
    title,
    summary: stringValue(data.summary) ?? null,
    description,
    workflows,
    tools,
    skills,
    runtimePolicy,
    reviewPolicy,
    mentionableWorkspaces: parseMentionableWorkspaces(normalized),
    sections,
    diagnostics,
    pendingFields,
  };
}

export function buildSpaceManifestProjection(
  spaceMdContent: string,
): SpaceManifestProjection {
  const manifest = parseSpaceManifest(spaceMdContent);
  const { diagnostics: _diagnostics, ...manifestForConfig } = manifest;
  const hasErrors = manifest.diagnostics.some((d) => d.severity === "error");
  const appliedFields: string[] = [];
  const autoApply: SpaceManifestProjection["autoApply"] = {};

  if (!hasErrors && manifest.descriptiveFrontmatter.name) {
    autoApply.name = manifest.descriptiveFrontmatter.name;
    appliedFields.push("name");
  }
  if (!hasErrors && manifest.descriptiveFrontmatter.description !== null) {
    autoApply.description = manifest.descriptiveFrontmatter.description;
    appliedFields.push("description");
  }

  const diagnosticCounts = {
    info: manifest.diagnostics.filter((d) => d.severity === "info").length,
    warning: manifest.diagnostics.filter((d) => d.severity === "warning")
      .length,
    error: manifest.diagnostics.filter((d) => d.severity === "error").length,
  };

  return {
    manifest,
    autoApply,
    configPatch: {
      spaceManifest: {
        ...manifestForConfig,
        diagnosticCounts,
      },
    },
    renderDiagnostics: {
      spaceManifest: {
        status: hasErrors
          ? "error"
          : manifest.diagnostics.some((d) => d.severity === "warning")
            ? "warning"
            : "ok",
        diagnostics: manifest.diagnostics,
        pendingFields: manifest.pendingFields,
        appliedFields,
        workflowCount: manifest.workflows.length,
        builtInToolCount: manifest.tools.builtIn.length,
        mcpToolCount: manifest.tools.mcp.length,
        skillCount: manifest.skills.length,
      },
    },
  };
}

function splitSpaceFrontmatter(source: string): {
  frontmatterPresent: boolean;
  frontmatter: string | null;
  body: string;
} {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatterPresent: false, frontmatter: null, body: source };
  }
  return {
    frontmatterPresent: true,
    frontmatter: match[1] ?? "",
    body: source.slice(match[0].length),
  };
}

function parseFrontmatter(
  source: string | null,
  diagnostics: SpaceManifestDiagnostic[],
): Record<string, unknown> {
  if (source === null) return {};
  try {
    const parsed = parseYaml(source);
    if (parsed === null) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      diagnostics.push({
        severity: "error",
        code: "SpaceManifestFrontmatterNotMapping",
        message: "SPACE.md frontmatter must be a YAML mapping.",
      });
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "SpaceManifestMalformedFrontmatter",
      message: `SPACE.md frontmatter could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return {};
  }
}

function parseSections(
  source: string,
): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const matches = Array.from(source.matchAll(/^##\s+(.+?)\s*$/gm));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const next = matches[index + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? source.length;
    sections.push({
      heading: match[1]!.trim(),
      body: source.slice(start, end).trim(),
    });
  }
  return sections;
}

function workflowsFromFrontmatter(
  value: unknown,
  diagnostics: SpaceManifestDiagnostic[],
): SpaceManifestWorkflow[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item, index): SpaceManifestWorkflow | null => {
      if (typeof item === "string") {
        const key = normalizeSlug(item);
        return key
          ? { key, name: item.trim(), description: null, source: "frontmatter" }
          : null;
      }
      if (!isRecord(item)) {
        diagnostics.push({
          severity: "warning",
          code: "SpaceManifestInvalidWorkflow",
          path: `workflows.${index}`,
          message: "Workflow entries must be strings or mappings.",
        });
        return null;
      }
      const name = stringValue(item.name) ?? stringValue(item.title);
      const key = normalizeSlug(stringValue(item.key) ?? name ?? "");
      if (!key || !name) {
        diagnostics.push({
          severity: "warning",
          code: "SpaceManifestInvalidWorkflow",
          path: `workflows.${index}`,
          message: "Workflow entries need at least a key/name.",
        });
        return null;
      }
      return {
        key,
        name,
        description: stringValue(item.description),
        source: "frontmatter",
      };
    })
    .filter((item): item is SpaceManifestWorkflow => Boolean(item));
}

function workflowsFromSection(
  section: { heading: string; body: string } | undefined,
): SpaceManifestWorkflow[] {
  if (!section) return [];
  return section.body
    .split("\n")
    .map((line): SpaceManifestWorkflow | null => {
      const match = line.match(/^\s*[-*]\s+(.+?)(?:\s+-\s+(.+))?\s*$/);
      if (!match) return null;
      const name = match[1]!.trim();
      const key = normalizeSlug(name);
      if (!key) return null;
      return {
        key,
        name,
        description: match[2]?.trim() ?? null,
        source: "markdown",
      };
    })
    .filter((item): item is SpaceManifestWorkflow => Boolean(item));
}

function toolsFromFrontmatter(
  data: Record<string, unknown>,
): SpaceManifestTools {
  const tools = isRecord(data.tools) ? data.tools : {};
  return {
    builtIn: uniqueSorted([
      ...stringList(tools.built_in),
      ...stringList(tools.builtIn),
      ...stringList(data.built_in_tools),
      ...stringList(data.builtInTools),
    ]),
    mcp: uniqueSorted([
      ...stringList(tools.mcp),
      ...stringList(tools.mcp_servers),
      ...stringList(data.mcp),
      ...stringList(data.mcp_servers),
    ]),
  };
}

function runtimePolicyFromFrontmatter(
  data: Record<string, unknown>,
  diagnostics: SpaceManifestDiagnostic[],
): SpaceManifestRuntimePolicy {
  const runtime = isRecord(data.runtime) ? data.runtime : {};
  const rawBash = stringValue(runtime.bash) ?? stringValue(data.bash);
  const bash = parseBashPolicy(rawBash, diagnostics);
  return {
    bash,
    model: stringValue(runtime.model) ?? stringValue(data.model),
    sandbox: booleanValue(runtime.sandbox) ?? booleanValue(data.sandbox),
  };
}

function reviewPolicyFromFrontmatter(
  data: Record<string, unknown>,
): SpaceManifestReviewPolicy {
  const policy = isRecord(data.policy) ? data.policy : {};
  const review = isRecord(data.review_policy)
    ? data.review_policy
    : isRecord(policy.review)
      ? policy.review
      : {};
  const rawMode =
    stringValue(review.mode) ??
    stringValue(data.review_policy) ??
    stringValue(data.review);
  const normalized = rawMode?.toLowerCase().replace(/\s+/g, "-");
  const mode =
    normalized === "none" ||
    normalized === "optional" ||
    normalized === "required"
      ? normalized
      : rawMode
        ? "unknown"
        : "none";
  return {
    mode,
    notes: stringValue(review.notes) ?? stringValue(policy.review_notes),
  };
}

function pendingBehaviorFields(data: Record<string, unknown>): string[] {
  return SECURITY_FIELD_PATHS.filter((field) => data[field] !== undefined);
}

function parseBashPolicy(
  value: string | null,
  diagnostics: SpaceManifestDiagnostic[],
): SpaceManifestRuntimePolicy["bash"] {
  if (!value) return "default";
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  if (
    normalized === "disabled" ||
    normalized === "read-only" ||
    normalized === "restricted" ||
    normalized === "enabled"
  ) {
    return normalized;
  }
  diagnostics.push({
    severity: "warning",
    code: "SpaceManifestUnknownBashPolicy",
    path: "runtime.bash",
    message: `Unknown bash policy '${value}' will not be applied.`,
  });
  return "default";
}

function firstHeading(source: string): string | null {
  return source.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? null;
}

function firstParagraph(source: string): string | null {
  const withoutHeadings = source
    .split("\n")
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n");
  const paragraph = withoutHeadings
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("```"));
  return paragraph ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
