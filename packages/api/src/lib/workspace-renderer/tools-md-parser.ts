import { parse as parseYaml } from "yaml";

export type ToolsMdDiagnostic = {
  code: string;
  message: string;
  path?: string;
};

export type ToolsModelRoutingMatch = Record<string, string>;

export interface ParsedToolsModelRoute {
  tool: string;
  match: ToolsModelRoutingMatch;
  model: string;
  reason?: string;
}

export interface ParsedToolsMdPolicy {
  frontmatterPresent: boolean;
  modelRouting: ParsedToolsModelRoute[];
  diagnostics: ToolsMdDiagnostic[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function splitFrontmatter(content: string): {
  frontmatterPresent: boolean;
  frontmatter: string;
} {
  const normalized = content.replace(/\r\n?/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  return {
    frontmatterPresent: Boolean(match),
    frontmatter: match?.[1] ?? "",
  };
}

function parseFrontmatter(
  frontmatter: string,
  diagnostics: ToolsMdDiagnostic[],
  path?: string,
): Record<string, unknown> {
  if (!frontmatter.trim()) return {};
  try {
    return asRecord(parseYaml(frontmatter)) ?? {};
  } catch (error) {
    diagnostics.push({
      code: "ToolsMdInvalidFrontmatter",
      path,
      message: `TOOLS.md frontmatter could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return {};
  }
}

function matchFromValue(
  value: unknown,
  diagnostics: ToolsMdDiagnostic[],
  path: string | undefined,
  routeIndex: number,
): ToolsModelRoutingMatch | null {
  if (value === undefined || value === null) return {};
  const record = asRecord(value);
  if (!record) {
    diagnostics.push({
      code: "ToolsMdInvalidModelRouteMatch",
      path,
      message: `modelRouting[${routeIndex}].match must be an object when present.`,
    });
    return null;
  }

  const match: ToolsModelRoutingMatch = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      match[normalizedKey] = String(rawValue).trim();
      continue;
    }
    diagnostics.push({
      code: "ToolsMdInvalidModelRouteMatchValue",
      path,
      message: `modelRouting[${routeIndex}].match.${normalizedKey} must be a string, number, or boolean.`,
    });
    return null;
  }
  return match;
}

function modelRoutingFromFrontmatter(
  value: unknown,
  diagnostics: ToolsMdDiagnostic[],
  path?: string,
): ParsedToolsModelRoute[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    diagnostics.push({
      code: "ToolsMdInvalidModelRouting",
      path,
      message: "modelRouting must be an array.",
    });
    return [];
  }

  const routes: ParsedToolsModelRoute[] = [];
  value.forEach((rawRoute, index) => {
    const route = asRecord(rawRoute);
    if (!route) {
      diagnostics.push({
        code: "ToolsMdInvalidModelRoute",
        path,
        message: `modelRouting[${index}] must be an object.`,
      });
      return;
    }

    const tool = stringValue(route.tool);
    const model = stringValue(route.model);
    const match = matchFromValue(route.match, diagnostics, path, index);
    if (!tool || !model || match === null) {
      diagnostics.push({
        code: "ToolsMdInvalidModelRoute",
        path,
        message: `modelRouting[${index}] must include non-empty tool and model values.`,
      });
      return;
    }

    const reason = stringValue(route.reason) ?? undefined;
    routes.push({
      tool,
      model,
      match,
      ...(reason ? { reason } : {}),
    });
  });

  return routes;
}

export function parseToolsMdPolicy(
  content: string,
  options: { path?: string } = {},
): ParsedToolsMdPolicy {
  const diagnostics: ToolsMdDiagnostic[] = [];
  const { frontmatterPresent, frontmatter } = splitFrontmatter(content);
  if (!frontmatterPresent) {
    return {
      frontmatterPresent: false,
      modelRouting: [],
      diagnostics,
    };
  }

  const data = parseFrontmatter(frontmatter, diagnostics, options.path);
  return {
    frontmatterPresent: true,
    modelRouting: modelRoutingFromFrontmatter(
      data.modelRouting,
      diagnostics,
      options.path,
    ),
    diagnostics,
  };
}
