export const BUILTIN_TOOL_SLUGS = ["web-search", "agent-email-send"] as const;

const BUILTIN_TOOL_SLUG_SET = new Set<string>(BUILTIN_TOOL_SLUGS);

export function isBuiltinToolSlug(slug: string): boolean {
  return BUILTIN_TOOL_SLUG_SET.has(slug);
}

export function isBuiltinToolWorkspacePath(path: string): boolean {
  const normalized = path.replace(/^\/+/, "");
  const match = normalized.match(/(?:^|\/)skills\/([^/]+)(?:\/|$)/);
  return Boolean(match?.[1] && isBuiltinToolSlug(match[1]));
}
