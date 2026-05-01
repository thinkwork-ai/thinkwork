/**
 * MarkdownSummary — operator-facing markdown rendering of the routine's
 * latest published version (Plan 2026-05-01-007 §U13).
 *
 * The agent-authored summary names HITL anchor points by ASL state name
 * (per the Phase C U10 prompt contract). When the parent run-detail
 * page passes `onAnchorClick`, we intercept clicks on `#step-<nodeId>`
 * anchors and route them to the graph's step-selection handler so the
 * graph + panel scroll/select to match.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownSummaryProps {
  markdown: string;
  /** Optional: when set, anchor clicks like `[Approve send](#step-Send)`
   * route to the parent's step-selection handler instead of letting the
   * browser scroll. */
  onAnchorClick?: (nodeId: string) => void;
}

export function MarkdownSummary({
  markdown,
  onAnchorClick,
}: MarkdownSummaryProps) {
  if (!markdown) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No summary published yet.
      </p>
    );
  }

  return (
    <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            const stepNodeId = parseStepAnchor(href);
            if (stepNodeId && onAnchorClick) {
              return (
                <a
                  href={href}
                  {...props}
                  onClick={(e) => {
                    e.preventDefault();
                    onAnchorClick(stepNodeId);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Parse `#step-<nodeId>` anchor href into the node id. Exported for
 * tests. */
export function parseStepAnchor(href: string | undefined): string | null {
  if (!href) return null;
  const match = href.match(/^#step-(.+)$/);
  return match ? match[1] : null;
}
