import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectedWorkspacePanel } from "./ProjectedWorkspacePanel";
import { parseWorkspaceProjection } from "./workspace-projection";

// Keep the default AGENTS.md loader's REST client out of these tests — every
// test injects `loadAgentsMd`, so the real module never has to resolve auth.
vi.mock("@/lib/workspace-files-api", () => ({
  spacesWorkspaceFilesClient: {
    getFile: vi.fn(async () => ({
      content: null,
      source: "thread",
      sha256: "",
    })),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FULL_PROJECTION = parseWorkspaceProjection({
  workspace_projection: {
    renderedPrefix: "tenants/acme/threads/thread-1/",
    sources: [
      {
        owner: "agent",
        prefix: "tenants/acme/agents/main/",
        etagSummary: "3:abc123def456",
      },
      { owner: "user:eric", prefix: "tenants/acme/users/eric/" },
    ],
    agentsMdKey: "tenants/acme/threads/thread-1/AGENTS.md",
    agentsMdHistoryKey:
      "tenants/acme/threads/thread-1/.agents-md-history/sha-abc.md",
    injectedFiles: ["AGENTS.md", "CONTEXT.md", "User/USER.md"],
    generatedAt: "2026-06-12T10:00:00.000Z",
    fetches: [
      {
        target: { kind: "space", slug: "ops" },
        outcome: "success",
        fileCount: 12,
        totalBytes: 34_000,
        at: "2026-06-12T10:01:00.000Z",
      },
      {
        target: { kind: "space", slug: "finance" },
        outcome: "denied",
        fileCount: 0,
        totalBytes: 0,
        deniedReason: "not_authorized",
        at: "2026-06-12T10:02:00.000Z",
      },
      {
        target: { kind: "user", slug: "casey" },
        outcome: "partial",
        fileCount: 200,
        totalBytes: 5_000_000,
        at: "2026-06-12T10:03:00.000Z",
      },
    ],
    reconcile: {
      rejectedCount: 2,
      rejections: [
        { path: "AGENTS.md", code: "read_only_generated_file" },
        { path: "fetched/spaces/ops/notes.md", code: "fetched_path_read_only" },
      ],
      updatedAt: "2026-06-12T10:05:00.000Z",
    },
  },
})!;

describe("ProjectedWorkspacePanel", () => {
  it("renders sources, injected files, fetch ledger, and reconcile rejections", () => {
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        loadAgentsMd={vi.fn(async () => "# AGENTS")}
      />,
    );

    expect(screen.getByText("Projected workspace")).toBeTruthy();
    // Header meta: 2 sources, 3 fetches.
    expect(screen.getByText(/2 sources · 3 fetches/)).toBeTruthy();
    // Rejection badge on the summary line.
    expect(
      screen.getByTestId("projection-rejections-badge").textContent,
    ).toContain("2 rejected");

    // Sources: owner + prefix + etag summary.
    expect(screen.getByText("agent")).toBeTruthy();
    expect(screen.getByText("tenants/acme/agents/main/")).toBeTruthy();
    expect(screen.getByText("3:abc123def456")).toBeTruthy();
    expect(screen.getByText("user:eric")).toBeTruthy();

    // Injected files.
    expect(screen.getByText("CONTEXT.md")).toBeTruthy();
    expect(screen.getByText("User/USER.md")).toBeTruthy();

    // Fetch ledger rows: target kind:slug, outcome chips, counts.
    const rows = screen.getAllByTestId("projection-fetch-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("space:ops");
    expect(rows[0].textContent).toContain("success");
    expect(rows[0].textContent).toContain("12 files");
    expect(rows[0].textContent).toContain("33 KB");

    // Reconcile rejections with their codes.
    expect(screen.getByText("read_only_generated_file")).toBeTruthy();
    expect(screen.getByText("fetched_path_read_only")).toBeTruthy();
    expect(screen.getByText("fetched/spaces/ops/notes.md")).toBeTruthy();
  });

  it("renders deniedReason for denied fetches and a partial outcome chip", () => {
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        loadAgentsMd={vi.fn(async () => "# AGENTS")}
      />,
    );

    const rows = screen.getAllByTestId("projection-fetch-row");
    expect(rows[1].textContent).toContain("space:finance");
    expect(rows[1].textContent).toContain("denied");
    expect(rows[1].textContent).toContain("not_authorized");
    expect(rows[2].textContent).toContain("user:casey");
    expect(rows[2].textContent).toContain("partial");
  });

  it("loads this turn's EXACT historical AGENTS.md from the history path with no caveat", async () => {
    // FULL_PROJECTION carries an agentsMdHistoryKey, so the panel reads the
    // write-once history copy via its prefix-relative path — exact content,
    // and NO caveat even though this turn is older (agentsMdMayDiffer set).
    const loadAgentsMd = vi.fn(async (_id: string, path: string | null) =>
      path === ".agents-md-history/sha-abc.md"
        ? "# Exact turn AGENTS\nrouting…"
        : "# Current render",
    );
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        agentsMdMayDiffer
        loadAgentsMd={loadAgentsMd}
      />,
    );

    expect(loadAgentsMd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    expect(loadAgentsMd).toHaveBeenCalledWith(
      "thread-1",
      ".agents-md-history/sha-abc.md",
    );

    await waitFor(() =>
      expect(screen.getByText(/# Exact turn AGENTS/)).toBeTruthy(),
    );
    // Exact content retained: no caveat, even for an older turn.
    expect(screen.queryByTestId("projection-agents-md-caveat")).toBeNull();
  });

  it("falls back to current AGENTS.md with the honest 'not retained' caveat when the history read returns null", async () => {
    const loadAgentsMd = vi.fn(async (_id: string, path: string | null) =>
      path === null ? "# Current render" : null,
    );
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        loadAgentsMd={loadAgentsMd}
      />,
    );

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    // History path tried first, then the current-render fallback.
    expect(loadAgentsMd).toHaveBeenNthCalledWith(
      1,
      "thread-1",
      ".agents-md-history/sha-abc.md",
    );
    await waitFor(() =>
      expect(screen.getByTestId("projection-agents-md-caveat")).toBeTruthy(),
    );
    expect(loadAgentsMd).toHaveBeenNthCalledWith(2, "thread-1", null);
    expect(
      screen.getByTestId("projection-agents-md-caveat").textContent,
    ).toMatch(/not retained/);
    expect(screen.getByText(/# Current render/)).toBeTruthy();
  });

  it("falls back to current AGENTS.md when this turn has no history key (pre-fix turn)", async () => {
    const preFix = parseWorkspaceProjection({
      workspace_projection: {
        renderedPrefix: "tenants/acme/threads/thread-1/",
        agentsMdKey: "tenants/acme/threads/thread-1/AGENTS.md",
      },
    })!;
    const loadAgentsMd = vi.fn(async () => "# Current render");
    render(
      <ProjectedWorkspacePanel
        projection={preFix}
        threadId="thread-1"
        loadAgentsMd={loadAgentsMd}
      />,
    );

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    // No history key → reads current AGENTS.md directly.
    expect(loadAgentsMd).toHaveBeenCalledWith("thread-1", null);
    await waitFor(() =>
      expect(screen.getByTestId("projection-agents-md-caveat")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("projection-agents-md-caveat").textContent,
    ).toMatch(/not retained/);
    expect(screen.getByText(/# Current render/)).toBeTruthy();
  });

  it("appends the may-differ wording on the fallback path when content may differ", async () => {
    const preFix = parseWorkspaceProjection({
      workspace_projection: {
        renderedPrefix: "tenants/acme/threads/thread-1/",
        agentsMdKey: "tenants/acme/threads/thread-1/AGENTS.md",
      },
    })!;
    render(
      <ProjectedWorkspacePanel
        projection={preFix}
        threadId="thread-1"
        agentsMdMayDiffer
        loadAgentsMd={vi.fn(async () => "# Later render")}
      />,
    );

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("projection-agents-md-caveat")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("projection-agents-md-caveat").textContent,
    ).toMatch(/later turn re-rendered/);
    expect(screen.getByText(/# Later render/)).toBeTruthy();
  });

  it("shows a graceful expired state when both the history and current reads fail", async () => {
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        loadAgentsMd={vi.fn(async () => {
          throw new Error("404 not found");
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    await waitFor(() =>
      expect(
        screen.getByTestId("projection-agents-md-unavailable"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByTestId("projection-agents-md-unavailable").textContent,
    ).toMatch(/no longer retrievable/);
  });

  it("shows an expired state when both reads return no content", async () => {
    render(
      <ProjectedWorkspacePanel
        projection={FULL_PROJECTION}
        threadId="thread-1"
        loadAgentsMd={vi.fn(async () => null)}
      />,
    );

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    await waitFor(() =>
      expect(
        screen.getByTestId("projection-agents-md-unavailable"),
      ).toBeTruthy(),
    );
  });

  it("marks content not retrievable when no threadId is available", () => {
    render(<ProjectedWorkspacePanel projection={FULL_PROJECTION} />);

    fireEvent.click(screen.getByTestId("projection-agents-md-toggle"));
    expect(
      screen.getByTestId("projection-agents-md-unavailable").textContent,
    ).toMatch(/not retrievable from this view/);
    // The S3 key is still surfaced for operators.
    expect(
      screen.getByText("tenants/acme/threads/thread-1/AGENTS.md"),
    ).toBeTruthy();
  });

  it("renders what exists for a minimal/malformed snapshot without crashing", () => {
    const minimal = parseWorkspaceProjection({ workspace_projection: {} })!;
    render(<ProjectedWorkspacePanel projection={minimal} threadId="t-1" />);

    expect(screen.getByText("Projected workspace")).toBeTruthy();
    expect(screen.getByText(/0 sources · 0 fetches/)).toBeTruthy();
    expect(screen.queryByTestId("projection-sources")).toBeNull();
    expect(screen.queryByTestId("projection-injected")).toBeNull();
    expect(screen.queryByTestId("projection-agents-md")).toBeNull();
    expect(screen.queryByTestId("projection-fetches")).toBeNull();
    expect(screen.queryByTestId("projection-reconcile")).toBeNull();
    expect(screen.queryByTestId("projection-rejections-badge")).toBeNull();
  });

  it("notes capped rejection lists", () => {
    const capped = parseWorkspaceProjection({
      workspace_projection: {
        reconcile: {
          rejectedCount: 25,
          rejections: [{ path: "a.md", code: "read_only_generated_file" }],
        },
      },
    })!;
    render(<ProjectedWorkspacePanel projection={capped} threadId="t-1" />);

    expect(screen.getByText("+24 more not shown")).toBeTruthy();
    expect(
      screen.getByTestId("projection-rejections-badge").textContent,
    ).toContain("25 rejected");
  });
});
