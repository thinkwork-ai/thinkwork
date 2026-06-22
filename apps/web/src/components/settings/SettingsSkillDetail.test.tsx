/**
 * Skill detail eval-panel tests (Skill Tests & Evals U9 + U6 held-update).
 *
 * Pins the score-state contract (unrated / scored / regression), the
 * "run evals now" gating + dispatch, and the held-update apply → blocked →
 * override flow. The SKILL.md editor below the panel is mocked out.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery, useSubscription } from "urql";

import {
  ApplySkillUpdateMutation,
  EvalDatasetsQuery,
  SkillEvalScoreDetailQuery,
} from "@/lib/evaluation-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { SettingsSkillDetail } from "./SettingsSkillDetail";

const mocks = vi.hoisted(() => ({
  exportSkillArchive: vi.fn(),
  fixSkillTrustEvidence: vi.fn(),
  runSkillTrustPipeline: vi.fn(),
  setHeader: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  workspaceFileEditor: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useSubscription: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useParams: () => ({ skillSlug: "web-research" }),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1", isOperator: true }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: mocks.setHeader,
}));

vi.mock("@/lib/workspace-files-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace-files-api")>();
  return {
    ...actual,
    exportSkillArchive: mocks.exportSkillArchive,
    fixSkillTrustEvidence: mocks.fixSkillTrustEvidence,
    runSkillTrustPipeline: mocks.runSkillTrustPipeline,
  };
});

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    cn: (...values: Array<string | false | null | undefined>) =>
      values.filter(Boolean).join(" "),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: (props: {
    defaultOpenFile?: string;
    target?: { skill?: string };
    targetKey?: string;
  }) => {
    mocks.workspaceFileEditor(props);
    return (
      <div
        data-testid="skill-file-editor"
        data-default-open-file={props.defaultOpenFile}
        data-skill={props.target?.skill}
        data-target-key={props.targetKey}
      />
    );
  },
}));

vi.mock("@thinkwork/ui", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  Button: ({
    asChild,
    children,
    className: _className,
    size: _size,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    size?: string;
    variant?: string;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type={props.type ?? "button"} {...props}>
        {children}
      </button>
    ),
  Sheet: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
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
  LoadingShimmer: () => <div />,
}));

const startRunMock = vi.fn();
const applyUpdateMock = vi.fn();

let scoreData: unknown;
let datasetsData: unknown;
const agentData = { agent: { id: "agent-1" } };

function renderLatestHeaderAction() {
  const action = mocks.setHeader.mock.calls.at(-1)?.[0]?.action;
  expect(action).toBeTruthy();
  return render(<>{action}</>);
}

async function openEvalsSheet() {
  const { getByRole } = renderLatestHeaderAction();
  fireEvent.click(getByRole("button", { name: "Skill evals" }));
  await screen.findByRole("dialog");
}

async function openInfoSheet() {
  const { getByRole } = renderLatestHeaderAction();
  fireEvent.click(getByRole("button", { name: "Skill info" }));
  await screen.findByRole("dialog");
}

async function openTrustSheet() {
  const { getByRole } = renderLatestHeaderAction();
  fireEvent.click(getByRole("button", { name: "Skill trust" }));
  await screen.findByRole("dialog");
}

function setupMocks() {
  vi.mocked(useQuery).mockImplementation((args) => {
    let data: unknown = undefined;
    if (args.query === SkillEvalScoreDetailQuery) data = scoreData;
    else if (args.query === EvalDatasetsQuery) data = datasetsData;
    else if (args.query === SettingsTenantAgentQuery) data = agentData;
    return [{ data, fetching: false, stale: false }, vi.fn()] as never;
  });
  vi.mocked(useMutation).mockImplementation((doc) => {
    const fn =
      doc === ApplySkillUpdateMutation ? applyUpdateMock : startRunMock;
    return [{ fetching: false, stale: false }, fn] as never;
  });
  vi.mocked(useSubscription).mockReturnValue([
    { fetching: false, stale: false },
    vi.fn(),
  ] as never);
}

beforeEach(() => {
  scoreData = {
    skillEvalScore: {
      skillSlug: "web-research",
      datasetSlug: "skill-web-research",
      rated: true,
      passRate: 0.8,
      regression: false,
      lastRunId: "run-1",
      lastRunAt: "2026-06-13T00:00:00Z",
      totalCases: 4,
      evaluable: true,
      ineligibleReason: null,
    },
  };
  datasetsData = { evalDatasets: [] };
  startRunMock.mockReset();
  startRunMock.mockResolvedValue({ data: { startEvalRun: { id: "run-2" } } });
  applyUpdateMock.mockReset();
  // Base resolution (e.g. the override re-apply succeeds); individual tests
  // override the first call with mockResolvedValueOnce.
  applyUpdateMock.mockResolvedValue({
    data: {
      applySkillUpdate: {
        applied: true,
        blocked: false,
        overridden: true,
        passRate: 0.5,
        threshold: 0.8,
      },
    },
  });
  mocks.exportSkillArchive.mockReset();
  mocks.exportSkillArchive.mockResolvedValue({
    slug: "web-research",
    filename: "web-research.zip",
    contentType: "application/zip",
    archiveBase64: "UEsDBAo=",
    bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    blob: new Blob([Uint8Array.from([0x50, 0x4b, 0x03, 0x04])], {
      type: "application/zip",
    }),
  });
  mocks.runSkillTrustPipeline.mockReset();
  mocks.runSkillTrustPipeline.mockResolvedValue({
    slug: "web-research",
    contentHash: "a".repeat(64),
    generatedAt: "2026-06-21T00:00:00.000Z",
    status: "review",
    summary:
      "Static trust evidence is available; SkillSpector is not configured in this environment.",
    spec: {
      status: "passed",
      name: "web-research",
      description: "Researches the web.",
      allowedTools: ["web_search"],
      errors: [],
    },
    scanner: { status: "not_configured" },
    severityCounts: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    findings: [],
    evidence: {
      skillCard: "present",
      evalDataset: "missing",
      benchmark: "missing",
      signature: "missing",
    },
    artifactPaths: {
      skillCard: "skill-card.md",
      evals: [],
    },
  });
  mocks.fixSkillTrustEvidence.mockReset();
  mocks.fixSkillTrustEvidence.mockResolvedValue({
    slug: "web-research",
    fixedStep: {
      step: "skillCard",
      status: "generated",
      message: "Generated skill-card.md.",
    },
    artifactPath: "skill-card.md",
    trustReport: {
      slug: "web-research",
      contentHash: "b".repeat(64),
      generatedAt: "2026-06-22T00:00:00.000Z",
      status: "review",
      summary: "Skill card evidence generated.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "not_configured" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "starter_generated",
        evalDataset: "missing",
        benchmark: "missing",
        signature: "missing",
      },
      artifactPaths: {
        skillCard: "skill-card.md",
        evals: [],
      },
    },
  });
  mocks.setHeader.mockReset();
  mocks.toastError.mockReset();
  mocks.toastInfo.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.workspaceFileEditor.mockReset();
  mocks.createObjectURL.mockReset();
  mocks.createObjectURL.mockReturnValue("blob:skill-archive");
  mocks.revokeObjectURL.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectURL,
  });
  setupMocks();
});

afterEach(() => {
  cleanup();
  vi.mocked(useQuery).mockReset();
  vi.mocked(useMutation).mockReset();
  vi.mocked(useSubscription).mockReset();
});

describe("SettingsSkillDetail eval panel", () => {
  it("registers a header export action that downloads the current skill archive", async () => {
    let downloadedFilename: string | null = null;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation(((
        tagName: string,
        options?: ElementCreationOptions,
      ) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === "a") {
          Object.defineProperty(element, "click", {
            configurable: true,
            value: vi.fn(() => {
              downloadedFilename = (element as HTMLAnchorElement).download;
            }),
          });
        }
        return element;
      }) as typeof document.createElement);

    render(<SettingsSkillDetail />);
    const { getByRole } = renderLatestHeaderAction();

    fireEvent.click(getByRole("button", { name: "Export skill archive" }));

    await waitFor(() =>
      expect(mocks.exportSkillArchive).toHaveBeenCalledWith("web-research"),
    );
    expect(mocks.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/zip" }),
    );
    expect(downloadedFilename).toBe("web-research.zip");
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:skill-archive");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill archive exported.");

    createElementSpy.mockRestore();
  });

  it("shows export failures and does not create a download", async () => {
    mocks.exportSkillArchive.mockRejectedValueOnce(new Error("archive failed"));
    render(<SettingsSkillDetail />);
    const { getByRole } = renderLatestHeaderAction();

    fireEvent.click(getByRole("button", { name: "Export skill archive" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not export the skill: archive failed",
      ),
    );
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });

  it("opens the source editor on SKILL.md for the selected skill", () => {
    render(<SettingsSkillDetail />);

    expect(
      screen
        .getByTestId("skill-file-editor")
        .getAttribute("data-default-open-file"),
    ).toBe("SKILL.md");
    expect(
      screen.getByTestId("skill-file-editor").getAttribute("data-skill"),
    ).toBe("web-research");
    expect(mocks.workspaceFileEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultOpenFile: "SKILL.md",
        target: { skill: "web-research" },
      }),
    );
  });

  it("renders a scored skill's pass rate and enables 'run evals now' in the evals sheet", async () => {
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    expect(screen.getByTestId("skill-eval-score").textContent).toBe("80%");
    expect(
      (screen.getByTestId("skill-run-evals") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByTestId("skill-held-update")).toBeNull();
  });

  it("shows a regression badge when the latest run regressed in the evals sheet", async () => {
    scoreData = {
      skillEvalScore: {
        ...(scoreData as { skillEvalScore: Record<string, unknown> })
          .skillEvalScore,
        regression: true,
      },
    };
    setupMocks();
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    expect(screen.getByText("Regression")).toBeTruthy();
  });

  it("renders 'Unrated' and disables the run action for an unrated skill", async () => {
    scoreData = {
      skillEvalScore: {
        skillSlug: "web-research",
        datasetSlug: "skill-web-research",
        rated: false,
        passRate: null,
        regression: false,
        lastRunId: null,
        lastRunAt: null,
        totalCases: 0,
        evaluable: true,
        ineligibleReason: null,
      },
    };
    setupMocks();
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    expect(screen.getByTestId("skill-eval-score").textContent).toBe("Unrated");
    expect(
      (screen.getByTestId("skill-run-evals") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("gates the run for a rated-but-non-evaluable skill and shows the reason", async () => {
    // A skill with cases but no WIRING.md: can't be materialized for an
    // isolated eval, so "Run evals now" must stay disabled with an explanation
    // (rather than letting the operator hit EvalBaselineMaterializationError).
    scoreData = {
      skillEvalScore: {
        skillSlug: "research-dashboard",
        datasetSlug: "skill-research-dashboard",
        rated: true,
        passRate: null,
        regression: false,
        lastRunId: null,
        lastRunAt: null,
        totalCases: 1,
        evaluable: false,
        ineligibleReason: "This skill has no WIRING.md, so it can't be run.",
      },
    };
    setupMocks();
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    expect(
      (screen.getByTestId("skill-run-evals") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("skill-not-evaluable").textContent).toContain(
      "no WIRING.md",
    );
  });

  it("dispatches an on-demand run against the skill dataset", async () => {
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    fireEvent.click(screen.getByTestId("skill-run-evals"));
    await waitFor(() => expect(startRunMock).toHaveBeenCalledTimes(1));
    expect(startRunMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: { datasetSlug: "skill-web-research" },
    });
  });

  it("surfaces a held candidate update and applies it, then offers override when blocked", async () => {
    datasetsData = {
      evalDatasets: [
        {
          id: "ds-cand",
          slug: "skill-web-research-candidate",
          name: "web-research (candidate)",
          kind: "skill",
          version: 1,
          archivedAt: null,
          createdAt: "2026-06-13T00:00:00Z",
          updatedAt: "2026-06-13T00:00:00Z",
        },
      ],
    };
    applyUpdateMock.mockResolvedValueOnce({
      data: {
        applySkillUpdate: {
          applied: false,
          blocked: true,
          overridden: false,
          passRate: 0.5,
          threshold: 0.8,
        },
      },
    });
    setupMocks();
    render(<SettingsSkillDetail />);
    await openEvalsSheet();

    expect(screen.getByTestId("skill-held-update")).toBeTruthy();
    fireEvent.click(screen.getByTestId("skill-apply-update"));

    await waitFor(() => expect(applyUpdateMock).toHaveBeenCalledTimes(1));
    expect(applyUpdateMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      skillSlug: "web-research",
      agentId: "agent-1",
      override: false,
    });

    // Blocked → the override affordance appears.
    await waitFor(() =>
      expect(screen.getByTestId("skill-apply-override")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("skill-apply-override"));
    await waitFor(() => expect(applyUpdateMock).toHaveBeenCalledTimes(2));
    expect(applyUpdateMock).toHaveBeenLastCalledWith({
      tenantId: "tenant-1",
      skillSlug: "web-research",
      agentId: "agent-1",
      override: true,
    });
  });

  it("moves catalog source guidance into the info sheet", async () => {
    render(<SettingsSkillDetail />);

    expect(
      screen.queryByText(/Installed agent copies keep running/i),
    ).toBeNull();

    await openInfoSheet();

    expect(
      screen.getByText(/Installed agent copies keep running/i),
    ).toBeTruthy();
  });

  it("opens the trust sheet and runs the Skill Trust pipeline for the current skill", async () => {
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));

    await waitFor(() =>
      expect(mocks.runSkillTrustPipeline).toHaveBeenCalledWith("web-research"),
    );
    expect(await screen.findByText("Pipeline status")).toBeTruthy();
    expect(screen.getByText("review")).toBeTruthy();
    expect(screen.getByText("SkillSpector")).toBeTruthy();
    expect(screen.getByText("not configured")).toBeTruthy();
    expect(screen.getByText("Skill card")).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Skill trust pipeline completed.",
    );
  });

  it("opens a trust step detail from a clickable evidence row", async () => {
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByText("Pipeline status");
    fireEvent.click(
      screen.getByRole("button", { name: /Skill card trust step/i }),
    );

    expect(screen.getByTestId("skill-trust-step-detail")).toBeTruthy();
    expect(
      screen.getByText(/Documents what the skill does, who owns it/i),
    ).toBeTruthy();
    expect(screen.getByText("skill-card.md")).toBeTruthy();
    expect(screen.getByText("Current state")).toBeTruthy();
  });

  it("generates a missing skill card and refreshes the trust report", async () => {
    mocks.runSkillTrustPipeline.mockResolvedValueOnce({
      slug: "web-research",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "review",
      summary: "Missing skill card.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "completed" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "missing",
        evalDataset: "present",
        benchmark: "present",
        signature: "verified",
      },
      artifactPaths: {
        evals: ["evals/smoke.json"],
        benchmark: "BENCHMARK.md",
        signature: "skill.oms.sig",
      },
    });
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByRole("button", {
      name: /Skill card trust step: missing/i,
    });
    fireEvent.click(screen.getByTestId("skill-trust-fix-step"));

    await waitFor(() =>
      expect(mocks.fixSkillTrustEvidence).toHaveBeenCalledWith(
        "web-research",
        "skillCard",
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByText("starter generated").length).toBeGreaterThan(
        0,
      ),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Generated skill-card.md.");
  });

  it("shows the signing prerequisite instead of offering a fake signature", async () => {
    mocks.runSkillTrustPipeline.mockResolvedValueOnce({
      slug: "web-research",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "passed",
      summary: "Signing is not configured.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "completed" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "present",
        evalDataset: "present",
        benchmark: "present",
        signature: "missing_signing_config",
      },
      artifactPaths: {
        skillCard: "skill-card.md",
        evals: ["evals/smoke.json"],
        benchmark: "BENCHMARK.md",
      },
    });
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByRole("button", {
      name: /Signature trust step: missing signing config/i,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Signature trust step: missing signing config/i,
      }),
    );

    expect(
      screen.getByText(/Signing is not configured for this environment/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("skill-trust-fix-step")).toBeNull();
    expect(mocks.fixSkillTrustEvidence).not.toHaveBeenCalled();
  });

  it("refreshes the editor target key after generating benchmark evidence", async () => {
    mocks.runSkillTrustPipeline.mockResolvedValueOnce({
      slug: "web-research",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "review",
      summary: "Missing benchmark.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "completed" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "present",
        evalDataset: "present",
        benchmark: "missing",
        signature: "missing",
      },
      artifactPaths: {
        skillCard: "skill-card.md",
        evals: ["evals/smoke.json"],
      },
    });
    mocks.fixSkillTrustEvidence.mockResolvedValueOnce({
      slug: "web-research",
      fixedStep: {
        step: "benchmark",
        status: "generated",
        message: "Generated BENCHMARK.md.",
      },
      artifactPath: "BENCHMARK.md",
      trustReport: {
        slug: "web-research",
        contentHash: "c".repeat(64),
        generatedAt: "2026-06-22T00:00:00.000Z",
        status: "passed",
        summary: "Benchmark evidence generated.",
        spec: {
          status: "passed",
          name: "web-research",
          description: "Researches the web.",
          allowedTools: ["web_search"],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "present",
          evalDataset: "present",
          benchmark: "starter_generated",
          signature: "missing",
        },
        artifactPaths: {
          skillCard: "skill-card.md",
          evals: ["evals/smoke.json"],
          benchmark: "BENCHMARK.md",
        },
      },
    });
    render(<SettingsSkillDetail />);
    const initialKey =
      mocks.workspaceFileEditor.mock.calls.at(-1)?.[0]?.targetKey;
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByRole("button", {
      name: /Benchmark trust step: missing/i,
    });
    fireEvent.click(screen.getByTestId("skill-trust-fix-step"));

    await waitFor(() =>
      expect(mocks.fixSkillTrustEvidence).toHaveBeenCalledWith(
        "web-research",
        "benchmark",
      ),
    );
    await waitFor(() => {
      const latestKey =
        mocks.workspaceFileEditor.mock.calls.at(-1)?.[0]?.targetKey;
      expect(latestKey).not.toBe(initialKey);
      expect(latestKey).toBe("skill:web-research:1");
    });
  });

  it("keeps the refreshed report visible with a catalog reindex warning", async () => {
    mocks.runSkillTrustPipeline.mockResolvedValueOnce({
      slug: "web-research",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "review",
      summary: "Missing skill card.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "completed" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "missing",
        evalDataset: "present",
        benchmark: "present",
        signature: "missing",
      },
      artifactPaths: {
        evals: ["evals/smoke.json"],
        benchmark: "BENCHMARK.md",
      },
    });
    mocks.fixSkillTrustEvidence.mockResolvedValueOnce({
      slug: "web-research",
      fixedStep: {
        step: "skillCard",
        status: "generated",
        message: "Generated skill-card.md.",
      },
      artifactPath: "skill-card.md",
      indexWarning: "Skill catalog index not updated.",
      trustReport: {
        slug: "web-research",
        contentHash: "b".repeat(64),
        generatedAt: "2026-06-22T00:00:00.000Z",
        status: "review",
        summary: "Generated with warning.",
        spec: {
          status: "passed",
          name: "web-research",
          description: "Researches the web.",
          allowedTools: ["web_search"],
          errors: [],
        },
        scanner: { status: "completed" },
        severityCounts: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
        findings: [],
        evidence: {
          skillCard: "starter_generated",
          evalDataset: "present",
          benchmark: "present",
          signature: "missing",
        },
        artifactPaths: {
          skillCard: "skill-card.md",
          evals: ["evals/smoke.json"],
          benchmark: "BENCHMARK.md",
        },
      },
    });
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByRole("button", {
      name: /Skill card trust step: missing/i,
    });
    fireEvent.click(screen.getByTestId("skill-trust-fix-step"));

    expect(
      await screen.findByText("Skill catalog index not updated."),
    ).toBeTruthy();
    expect(screen.getAllByText("starter generated").length).toBeGreaterThan(0);
  });

  it("surfaces trust evidence fix failures without clearing the report", async () => {
    mocks.runSkillTrustPipeline.mockResolvedValueOnce({
      slug: "web-research",
      contentHash: "a".repeat(64),
      generatedAt: "2026-06-21T00:00:00.000Z",
      status: "review",
      summary: "Missing benchmark.",
      spec: {
        status: "passed",
        name: "web-research",
        description: "Researches the web.",
        allowedTools: ["web_search"],
        errors: [],
      },
      scanner: { status: "completed" },
      severityCounts: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
      evidence: {
        skillCard: "present",
        evalDataset: "present",
        benchmark: "missing",
        signature: "missing",
      },
      artifactPaths: {
        skillCard: "skill-card.md",
        evals: ["evals/smoke.json"],
      },
    });
    mocks.fixSkillTrustEvidence.mockRejectedValueOnce(new Error("writer down"));
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));
    await screen.findByRole("button", {
      name: /Benchmark trust step: missing/i,
    });
    fireEvent.click(screen.getByTestId("skill-trust-fix-step"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not fix the trust step: writer down",
      ),
    );
    expect(screen.getAllByText("missing").length).toBeGreaterThan(0);
  });

  it("surfaces Skill Trust pipeline failures", async () => {
    mocks.runSkillTrustPipeline.mockRejectedValueOnce(new Error("runner down"));
    render(<SettingsSkillDetail />);
    await openTrustSheet();

    fireEvent.click(screen.getByTestId("skill-run-trust"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not run the trust pipeline: runner down",
      ),
    );
  });
});
