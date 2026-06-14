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
  SkillEvalScoreQuery,
} from "@/lib/evaluation-queries";
import { SettingsTenantAgentQuery } from "@/lib/settings-queries";
import { SettingsSkillDetail } from "./SettingsSkillDetail";

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
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: () => <div data-testid="skill-file-editor" />,
}));

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div />,
}));

const startRunMock = vi.fn();
const applyUpdateMock = vi.fn();

let scoreData: unknown;
let datasetsData: unknown;
const agentData = { agent: { id: "agent-1" } };

function setupMocks() {
  vi.mocked(useQuery).mockImplementation((args) => {
    let data: unknown = undefined;
    if (args.query === SkillEvalScoreQuery) data = scoreData;
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
  setupMocks();
});

afterEach(() => {
  cleanup();
  vi.mocked(useQuery).mockReset();
  vi.mocked(useMutation).mockReset();
  vi.mocked(useSubscription).mockReset();
});

describe("SettingsSkillDetail eval panel", () => {
  it("renders a scored skill's pass rate and enables 'run evals now'", () => {
    render(<SettingsSkillDetail />);
    expect(screen.getByTestId("skill-eval-score").textContent).toBe("80%");
    expect(
      (screen.getByTestId("skill-run-evals") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByTestId("skill-held-update")).toBeNull();
  });

  it("shows a regression badge when the latest run regressed", () => {
    scoreData = {
      skillEvalScore: {
        ...(scoreData as { skillEvalScore: Record<string, unknown> })
          .skillEvalScore,
        regression: true,
      },
    };
    setupMocks();
    render(<SettingsSkillDetail />);
    expect(screen.getByText("Regression")).toBeTruthy();
  });

  it("renders 'Unrated' and disables the run action for an unrated skill", () => {
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
      },
    };
    setupMocks();
    render(<SettingsSkillDetail />);
    expect(screen.getByTestId("skill-eval-score").textContent).toBe("Unrated");
    expect(
      (screen.getByTestId("skill-run-evals") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("dispatches an on-demand run against the skill dataset", async () => {
    render(<SettingsSkillDetail />);
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
});
