/**
 * THINK-154: document artifact digests may lead with compiler frontmatter
 * (---\neyebrow: …\n---). It is a compiler input, not reader-facing content,
 * and markdown renderers garble it (hr + setext heading) — strip it before
 * rendering a digest body. Mirrors the server-side helper in
 * packages/api/src/lib/artifacts/document-compositor.ts.
 */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function stripLeadingFrontmatter(markdown: string): string {
  const match = FRONTMATTER_RE.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
