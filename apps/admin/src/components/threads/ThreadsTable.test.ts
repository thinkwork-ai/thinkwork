/**
 * Source-grep structural coverage for ThreadsTable — admin's test
 * convention is filesystem-based assertion rather than DOM rendering
 * (no RTL is wired up). Verifies the component exposes the expected
 * surface and keeps the runtime/model columns wired so refactors
 * don't silently strip behavior.
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
    expect(source).toContain("export function formatRuntimeType");
    expect(source).toContain("export function formatModelId");
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

  it("renders runtime and model as separate columns instead of the old agent column", () => {
    expect(source).toContain('header: "Runtime"');
    expect(source).toContain('header: "Model"');
    expect(source).toContain('variant="outline"');
    expect(source).toContain("threadUserLabel(row.original)");
    expect(source).toContain("row.original.lastRuntimeType");
    expect(source).toContain("row.original.lastModel");
    expect(source).toContain("formatModelId(model)");
    expect(source).not.toContain("assigneePickerIssueId");
    expect(source).not.toContain("Popover");
  });

  it("exports attribution label helpers for shared Computer rows", () => {
    expect(source).toContain("export function threadComputerLabel");
    expect(source).toContain("export function threadUserLabel");
    expect(source).toContain("Unknown Computer");
    expect(source).toContain("Unknown User");
  });

  it("renders named table headers for the thread list", () => {
    expect(source).toContain("hideHeader = false");
    expect(source).toContain('header: "Thread"');
    expect(source).toContain('header: "User"');
    expect(source).toContain('header: "Last Activity"');
    expect(source).not.toContain("flex-col items-end");
  });

  it("keeps a single scope toggle for future divergence", () => {
    expect(source).toContain('scope?: "tenant" | "computer"');
  });
});
