/**
 * Source-grep structural coverage for ThreadsTable — admin's test
 * convention is filesystem-based assertion rather than DOM rendering
 * (no RTL is wired up). Verifies the component exposes the expected
 * surface and keeps the popover + handlers wired so refactors don't
 * silently strip behavior.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("ThreadsTable shared component", () => {
  const source = read("./ThreadsTable.tsx");

  it("exports the component and supporting types", () => {
    expect(source).toContain("export function ThreadsTable");
    expect(source).toContain("export type ThreadsTableItem");
    expect(source).toContain("export type ThreadsTableAgent");
    expect(source).toContain("export type ThreadInboxStatus");
    expect(source).toContain("export interface ThreadsTableProps");
    expect(source).toContain("export function computeThreadInboxStatus");
  });

  it("passes thread handlers through props (no embedded state owner)", () => {
    expect(source).toContain("onUpdateThread");
    expect(source).toContain("onRowClick");
    expect(source).toContain("inboxStatusFor");
    // The component must NOT call useQuery / useMutation / useSubscription —
    // those belong to the consuming route so the same component can serve
    // both /threads (tenant scope) and Computer Detail (computer scope).
    expect(source).not.toContain("useQuery(");
    expect(source).not.toContain("useMutation(");
    expect(source).not.toContain("useSubscription(");
  });

  it("renders the assignee picker for non-Computer-owned threads", () => {
    expect(source).toContain("thread.computerId ? (");
    expect(source).toContain('Badge variant="outline"');
    expect(source).toContain("Computer-owned");
    expect(source).toContain("assigneePickerIssueId");
    expect(source).toContain("Popover");
  });

  it("keeps a single scope toggle for future divergence", () => {
    expect(source).toContain('scope?: "tenant" | "computer"');
  });
});
