import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatWikiContextTraceDetail,
  WikiContextTraceCard,
  wikiContextTraceFromRecord,
  wikiContextTraceKey,
  wikiContextTraceTitle,
} from "./WikiContextTraceCard";

describe("WikiContextTraceCard", () => {
  it("normalizes, redacts, and formats OKF wiki traces", () => {
    const trace = wikiContextTraceFromRecord({
      id: "tool-okf",
      tool_name: "wiki_rg",
      result: {
        details: {
          okfWikiTrace: {
            surface: "okf_efs",
            tool: "wiki_rg",
            query: "Acme",
            path: "topics",
            mountRoot: "/mnt/thinkwork-okf/tenants/acme/current",
            s3Key: "s3://thinkwork-okf/tenants/acme/current.json",
            matchCount: 1,
            entries: [
              {
                path: "topics/acme.md",
                title: "Acme",
                line: 4,
                snippet:
                  "See s3://thinkwork-okf/tenants/acme/private-source.md",
                absolutePath:
                  "/mnt/thinkwork-okf/tenants/acme/current/topics/acme.md",
              },
            ],
            bounds: {
              maxResults: 5,
              maxDepth: 2,
              maxBytes: 4096,
              truncated: true,
            },
            redaction: {
              source: "okf_navigator",
              policy: "cite_or_summarize_only",
            },
          },
        },
      },
    });

    expect(trace).toMatchObject({
      surface: "okf_efs",
      tool: "wiki_rg",
      tool_call_id: "tool-okf",
      query: "Acme",
      matchCount: 1,
    });
    expect(JSON.stringify(trace)).not.toContain("/mnt/thinkwork-okf");
    expect(JSON.stringify(trace)).not.toContain("s3://");
    expect(JSON.stringify(trace)).not.toContain("s3Key");
    expect(wikiContextTraceKey(trace)).toBe("tool-okf:wiki_rg:Acme:topics:1");
    expect(wikiContextTraceTitle(trace!)).toBe("OKF wiki returned 1 item");

    const detail = formatWikiContextTraceDetail(trace!);
    expect(detail).toContain("Tool: wiki_rg");
    expect(detail).toContain("Query: Acme");
    expect(detail).toContain("maxResults=5");
    expect(detail).toContain("truncated=true");
    expect(detail).toContain("Redaction: cite_or_summarize_only");
    expect(detail).toContain("topics/acme.md");
    expect(detail).toContain("line 4");
    expect(detail).not.toContain("s3://");

    render(<WikiContextTraceCard trace={trace!} />);
    expect(screen.getByText("OKF wiki returned 1 item")).toBeTruthy();
    expect(screen.getByText("truncated")).toBeTruthy();
    expect(screen.getByText("Query: Acme")).toBeTruthy();
  });
});
