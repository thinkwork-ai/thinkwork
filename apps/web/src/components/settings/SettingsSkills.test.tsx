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
  importSkillArchive: vi.fn(),
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
    importSkillArchive: mocks.importSkillArchive,
  };
});

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
    data,
    emptyState,
    onRowClick,
  }: {
    data: Array<{ slug: string; displayName?: string | null }>;
    emptyState?: React.ReactNode;
    onRowClick?: (row: { slug: string }) => void;
  }) => (
    <div data-testid="skills-table">
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
        : emptyState}
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

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div>Loading skills</div>,
}));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.listSkillSummaries.mockReset();
  mocks.importSkillArchive.mockReset();
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
    },
  ]);
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

  it("registers import as a muted header action", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    const action = mocks.setHeader.mock.calls.at(-1)?.[0]?.action;
    expect(action).toBeTruthy();
    const { getByRole } = render(<>{action}</>);

    expect(getByRole("button", { name: "Import skill archive" })).toBeTruthy();
  });

  it("imports a ZIP archive, refreshes the list, and opens the imported skill", async () => {
    mocks.importSkillArchive.mockResolvedValue({
      slug: "new-skill",
      status: "created",
      generatedWiring: true,
    });

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("skill.zip", Uint8Array.from([0x50, 0x4b, 0x00, 0xff]));

    await waitFor(() => {
      expect(mocks.importSkillArchive).toHaveBeenCalledWith("UEsA/w==", {
        confirmReplace: false,
      });
    });
    await waitFor(() => {
      expect(mocks.listSkillSummaries).toHaveBeenCalledTimes(2);
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill imported.");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/skills/$skillSlug",
      params: { skillSlug: "new-skill" },
    });
  });

  it("does not submit non-ZIP files", async () => {
    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("skill.txt", Uint8Array.from([0x50, 0x4b]), "text/plain");

    expect(mocks.importSkillArchive).not.toHaveBeenCalled();
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

    expect(mocks.importSkillArchive).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("confirms before replacing an existing skill", async () => {
    mocks.importSkillArchive
      .mockRejectedValueOnce(
        new ApiError(409, {
          ok: false,
          code: "skill_exists",
          slug: "existing-skill",
          error: "Catalog skill 'existing-skill' already exists.",
        }),
      )
      .mockResolvedValueOnce({
        slug: "existing-skill",
        status: "updated",
        generatedWiring: false,
      });

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("existing-skill.zip", Uint8Array.from([0x50, 0x4b]));

    expect((await screen.findByRole("dialog")).textContent).toContain(
      "existing-skill",
    );
    expect(mocks.importSkillArchive).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    await waitFor(() => {
      expect(mocks.importSkillArchive).toHaveBeenLastCalledWith("UEs=", {
        confirmReplace: true,
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill updated.");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings/skills/$skillSlug",
      params: { skillSlug: "existing-skill" },
    });
  });

  it("cancels replacement without resubmitting", async () => {
    mocks.importSkillArchive.mockRejectedValueOnce(
      new ApiError(409, {
        ok: false,
        code: "skill_exists",
        slug: "existing-skill",
        error: "Catalog skill 'existing-skill' already exists.",
      }),
    );

    render(<SettingsSkills />);
    await screen.findByPlaceholderText("Search skills…");

    uploadArchive("existing-skill.zip", Uint8Array.from([0x50, 0x4b]));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.importSkillArchive).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("surfaces API validation failures without navigating", async () => {
    mocks.importSkillArchive.mockRejectedValueOnce(
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

  it("shows requested-by and status columns without an action column", async () => {
    mocks.draftsQueryState.data = {
      skillDrafts: [submittedDraft()],
    };

    render(<SettingsSkills tab="drafts" />);
    expect(await screen.findByText("Customer Brief")).toBeTruthy();

    expect(screen.getByText("Requested by")).toBeTruthy();
    expect(screen.getByText("Eric")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("submitted")).toBeTruthy();
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
