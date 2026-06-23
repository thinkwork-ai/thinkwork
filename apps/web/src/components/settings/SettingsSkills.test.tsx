import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-fetch";
import { SettingsSkills } from "./SettingsSkills";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  listSkillSummaries: vi.fn(),
  getSkillCardFile: vi.fn(),
  getSkillTrustReport: vi.fn(),
  runSkillTrustPipeline: vi.fn(),
  fixSkillTrustEvidence: vi.fn(),
  importSkillArchiveAsDraft: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  setHeader: vi.fn(),
  publishSkillDraft: vi.fn(),
  refetchDrafts: vi.fn(),
  draftsQueryState: {
    data: undefined as
      | {
          skillDrafts: Array<{
            id: string;
            tenantId: string;
            slug: string;
            title: string;
            displayName?: string | null;
            summary?: string | null;
            status: string;
            currentContentHash?: string | null;
            inboxItemId?: string | null;
            submittedAt?: string | null;
            createdAt: string;
            updatedAt: string;
            requester?: {
              id: string;
              name?: string | null;
              email?: string | null;
            } | null;
            source: {
              kind: string;
              threadId?: string | null;
              messageId?: string | null;
            };
          }>;
        }
      | undefined,
    fetching: false,
    error: undefined as { message: string } | undefined,
  },
}));

type SkillDraftFixture = NonNullable<
  (typeof mocks.draftsQueryState)["data"]
>["skillDrafts"][number];

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/lib/workspace-files-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace-files-api")>();
  return {
    ...actual,
    listSkillSummaries: mocks.listSkillSummaries,
    getSkillTrustReport: mocks.getSkillTrustReport,
    runSkillTrustPipeline: mocks.runSkillTrustPipeline,
    fixSkillTrustEvidence: mocks.fixSkillTrustEvidence,
    skillCatalogClient: {
      getFile: mocks.getSkillCardFile,
    },
    importSkillArchiveAsDraft: mocks.importSkillArchiveAsDraft,
  };
});

vi.mock("@/components/ai-elements/response", () => ({
  Response: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

vi.mock("urql", () => ({
  useQuery: () => [mocks.draftsQueryState, mocks.refetchDrafts],
  useMutation: () => [{ fetching: false }, mocks.publishSkillDraft],
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button type={props.type ?? "button"} {...props}>
      {children}
    </button>
  ),
  DataTable: ({
    columns,
    data,
    emptyState,
    onRowClick,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      header?: React.ReactNode;
      cell?: (ctx: { row: { original: SkillRowFixture } }) => React.ReactNode;
    }>;
    data: SkillRowFixture[];
    emptyState?: React.ReactNode;
    onRowClick?: (row: SkillRowFixture) => void;
  }) => (
    <div data-testid="skills-table">
      {data.length ? (
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={String(column.id ?? column.accessorKey)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.slug}>
                {columns.map((column) => (
                  <td key={String(column.id ?? column.accessorKey)}>
                    {column.cell
                      ? column.cell({ row: { original: row } })
                      : String(
                          row[column.accessorKey as keyof SkillRowFixture] ??
                            "",
                        )}
                  </td>
                ))}
                <td>
                  <button type="button" onClick={() => onRowClick?.(row)}>
                    Open {row.displayName ?? row.slug}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        emptyState
      )}
      <div className="sr-only">
        {data.length
          ? data.map((row) => (
              <button
                key={row.slug}
                type="button"
                onClick={() => onRowClick?.(row)}
              >
                {row.displayName ?? row.slug}
              </button>
            ))
          : null}
      </div>
    </div>
  ),
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Sheet: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div>{children}</div> : null),
  SheetContent: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SheetDescription: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  SheetHeader: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SheetTitle: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  Spinner: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>Loading</span>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

type SkillRowFixture = {
  slug: string;
  displayName?: string | null;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  tags?: string[] | null;
  sha: string;
  trustStatus?: "passed" | "review" | "blocked" | "failed" | null;
  trustStale?: boolean | null;
  trustUpdatedAt?: string | null;
  skillCardStatus?: "present" | "missing" | "starter_generated" | null;
};

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading skills</div>,
}));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.listSkillSummaries.mockReset();
  mocks.getSkillCardFile.mockReset();
  mocks.getSkillTrustReport.mockReset();
  mocks.runSkillTrustPipeline.mockReset();
  mocks.fixSkillTrustEvidence.mockReset();
  mocks.importSkillArchiveAsDraft.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastWarning.mockReset();
  mocks.setHeader.mockReset();
  mocks.publishSkillDraft.mockReset();
  mocks.refetchDrafts.mockReset();
  mocks.draftsQueryState.data = undefined;
  mocks.draftsQueryState.fetching = false;
  mocks.draftsQueryState.error = undefined;
  mocks.listSkillSummaries.mockResolvedValue([
    {
      slug: "existing-skill",
      displayName: "Existing Skill",
      description: null,
      category: null,
      icon: null,
      tags: null,
      sha: "sha",
      trustStatus: "passed",
      trustStale: false,
      skillCardStatus: "starter_generated",
    },
  ]);
  mocks.getSkillCardFile.mockResolvedValue({
    content: "# Existing Skill Card\n\nSummary.",
    source: "catalog",
    sha256: "card-sha",
  });
  mocks.getSkillTrustReport.mockResolvedValue({
    slug: "existing-skill",
    trustReport: {
      slug: "existing-skill",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-22T00:00:00.000Z",
      status: "passed",
      summary: "SkillSpector passed and release evidence is present.",
      spec: { status: "passed", allowedTools: [], errors: [] },
      scanner: { status: "completed" },
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      evidence: {
        skillCard: "starter_generated",
        evalDataset: "starter_generated",
        benchmark: "starter_generated",
        signature: "verified",
      },
      artifactPaths: {
        skillCard: "skill-card.md",
        evals: ["evals/smoke.json"],
        benchmark: "BENCHMARK.md",
        signature: "skill.oms.sig",
      },
    },
    cached: true,
    stale: false,
  });
});

afterEach(cleanup);

describe("SettingsSkills import", () => {
  it("registers route-backed header tabs without rendering in-page tabs", async () => {
    mocks.draftsQueryState.data = {
      skillDrafts: [submittedDraft()],
    };

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    const headerConfig = mocks.setHeader.mock.calls.at(-1)?.[0];
    expect(headerConfig?.title).toBe("Skill Library");
    expect(headerConfig?.tabs).toEqual([
      { to: "/settings/skills", label: "Published" },
      { to: "/settings/skills/drafts", label: "Drafts (1)" },
    ]);
    expect(screen.queryByRole("button", { name: /^Published$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Drafts/ })).toBeNull();
  });

  it("renders the published search input and update gate on one toolbar row", async () => {
    render(<SettingsSkills />);
    const search = await screen.findByPlaceholderText("Search skills…");

    const toolbar = screen.getByTestId("skill-published-toolbar");
    const actions = screen.getByTestId("skill-published-toolbar-actions");
    const gate = screen.getByRole("button", { name: /Update gate:/ });

    expect(toolbar.contains(search)).toBe(true);
    expect(toolbar.contains(gate)).toBe(true);
    expect(actions.contains(gate)).toBe(true);
  });

  it("shows skill card and trust pipeline badges instead of the description column", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    expect(screen.getByText("Skill card")).toBeTruthy();
    expect(screen.getByText("Trust pipeline")).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Eval score")).toBeNull();
  });

  it("opens skill card and trust sheets from published badges", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open skill card for Existing Skill",
      }),
    );

    await screen.findByRole("heading", { name: "Skill card" });
    expect(screen.getByTestId("skill-card-markdown").textContent).toContain(
      "Existing Skill Card",
    );
    expect(mocks.getSkillCardFile).toHaveBeenCalledWith(
      { skill: "existing-skill" },
      "skill-card.md",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open trust pipeline for Existing Skill",
      }),
    );

    await screen.findByRole("heading", { name: "Skill trust" });
    expect(mocks.getSkillTrustReport).toHaveBeenCalledWith("existing-skill");
    expect(
      screen.getByText("SkillSpector passed and release evidence is present."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run pipeline" })).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("registers import as a muted header action", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    const action = mocks.setHeader.mock.calls.at(-1)?.[0]?.action;
    expect(action).toBeTruthy();
    const { getByRole } = render(<>{action}</>);

    expect(getByRole("button", { name: "Import skill archive" })).toBeTruthy();
  });

  it("imports a ZIP archive as a draft, refetches drafts, and opens the draft detail", async () => {
    mocks.importSkillArchiveAsDraft.mockResolvedValue({
      draftId: "draft-import-1",
      slug: "new-skill",
      status: "submitted",
      generatedWiring: true,
      currentContentHash: "sha256:abc",
    });

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("skill.zip", Uint8Array.from([0x50, 0x4b, 0x00, 0xff]));

    await waitFor(() => {
      expect(mocks.importSkillArchiveAsDraft).toHaveBeenCalledWith("UEsA/w==");
    });
    expect(mocks.refetchDrafts).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(mocks.listSkillSummaries).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Skill draft imported for review.",
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/skills/drafts/$draftId",
      params: { draftId: "draft-import-1" },
    });
  });

  it("does not submit non-ZIP files", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("skill.txt", Uint8Array.from([0x50, 0x4b]), "text/plain");

    expect(mocks.importSkillArchiveAsDraft).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Choose a .zip skill archive.",
    );
  });

  it("does not submit when the file picker is cleared", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    fireEvent.change(screen.getByTestId("skill-import-input"), {
      target: { files: [] },
    });

    expect(mocks.importSkillArchiveAsDraft).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("imports same-slug archives as drafts without replacing catalog skills", async () => {
    mocks.importSkillArchiveAsDraft.mockResolvedValueOnce({
      draftId: "draft-existing-1",
      slug: "existing-skill",
      status: "submitted",
      generatedWiring: false,
      currentContentHash: "sha256:def",
    });

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("existing-skill.zip", Uint8Array.from([0x50, 0x4b]));

    await waitFor(() => {
      expect(mocks.importSkillArchiveAsDraft).toHaveBeenCalledWith("UEs=");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Skill draft imported for review.",
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/skills/drafts/$draftId",
      params: { draftId: "draft-existing-1" },
    });
  });

  it("surfaces API validation failures without navigating", async () => {
    mocks.importSkillArchiveAsDraft.mockRejectedValueOnce(
      new ApiError(
        400,
        {
          ok: false,
          code: "invalid_skill_archive",
          error: "Archive must include SKILL.md.",
        },
        "Archive must include SKILL.md.",
      ),
    );

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("broken.zip", Uint8Array.from([0x50, 0x4b]));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Archive must include SKILL.md.",
      );
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("SettingsSkills drafts", () => {
  it("opens a draft detail editor when a draft row is clicked", async () => {
    mocks.draftsQueryState.data = {
      skillDrafts: [submittedDraft()],
    };

    render(<SettingsSkills tab="drafts" />);
    const row = await screen.findByRole("button", { name: /Customer Brief/ });

    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/skills/drafts/$draftId",
      params: { draftId: "draft-1" },
    });
  });

  it("shows compact draft review columns without extra row detail", async () => {
    mocks.draftsQueryState.data = {
      skillDrafts: [submittedDraft()],
    };

    render(<SettingsSkills tab="drafts" />);
    expect(await screen.findByText("Customer Brief")).toBeTruthy();

    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Requested by")).toBeTruthy();
    expect(screen.getByText("Eric")).toBeTruthy();
    expect(screen.getByText("Skill card")).toBeTruthy();
    expect(screen.getByText("Trust card")).toBeTruthy();
    expect(screen.getAllByText("Not run")).toHaveLength(2);
    expect(screen.queryByText("submitted")).toBeNull();
    expect(screen.queryByText("customer-brief")).toBeNull();
    expect(screen.queryByText("Thread thread-1")).toBeNull();
    expect(
      screen.queryByText("Creates a concise customer briefing."),
    ).toBeNull();
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });
});

function uploadArchive(
  name: string,
  bytes: Uint8Array,
  type = "application/zip",
) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(buffer),
  });
  fireEvent.change(screen.getByTestId("skill-import-input"), {
    target: { files: [file] },
  });
}

function submittedDraft(
  overrides: Partial<SkillDraftFixture> = {},
): SkillDraftFixture {
  return {
    id: "draft-1",
    tenantId: "tenant-1",
    slug: "customer-brief",
    title: "Customer Brief",
    displayName: "Customer Brief",
    summary: "Creates a concise customer briefing.",
    status: "submitted",
    currentContentHash: "sha",
    inboxItemId: null,
    submittedAt: "2026-06-21T12:00:00Z",
    createdAt: "2026-06-21T12:00:00Z",
    updatedAt: "2026-06-21T12:00:00Z",
    requester: {
      id: "user-1",
      name: "Eric",
      email: "eric@example.com",
    },
    source: {
      kind: "thread",
      threadId: "thread-1",
      messageId: "message-1",
    },
    ...overrides,
  };
}
