import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approveMock, queryDocs, refreshJobMock, rejectMock, useQueryMock } =
  vi.hoisted(() => ({
    approveMock: vi.fn(),
    queryDocs: {
      SettingsApproveManagedApplicationDeploymentMutation: Symbol("approve"),
      SettingsManagedApplicationDeploymentQuery: Symbol("deployment"),
      SettingsRejectManagedApplicationDeploymentMutation: Symbol("reject"),
      SettingsDeploymentEvidenceQuery: Symbol("evidence"),
    },
    refreshJobMock: vi.fn(),
    rejectMock: vi.fn(),
    useQueryMock: vi.fn(),
  }));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsApproveManagedApplicationDeploymentMutation) {
      return [{ fetching: false }, approveMock];
    }
    if (doc === queryDocs.SettingsRejectManagedApplicationDeploymentMutation) {
      return [{ fetching: false }, rejectMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

import { ManagedApplicationPlanDialog } from "./ManagedApplicationPlanDialog";

beforeEach(() => {
  approveMock.mockReset();
  rejectMock.mockReset();
  approveMock.mockResolvedValue({
    data: {
      approveManagedApplicationDeployment: {
        ...twentyDestroyJob,
        status: "applying",
      },
    },
  });
  rejectMock.mockResolvedValue({
    data: { rejectManagedApplicationDeployment: null },
  });
  refreshJobMock.mockReset();
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsManagedApplicationDeploymentQuery) {
      return [
        {
          data: { managedApplicationDeployment: null },
          fetching: false,
        },
        refreshJobMock,
      ];
    }
    return [
      {
        data: {
          deploymentEvidence: {
            jobId: twentyDestroyJob.id,
            bucket: "tw-evidence",
            prefix: "plans/twenty",
            urls: [],
          },
        },
        fetching: false,
      },
      vi.fn(),
    ];
  });
});

afterEach(cleanup);

describe("ManagedApplicationPlanDialog", () => {
  it("requires app-specific destructive confirmation before approving Twenty destroy", async () => {
    render(
      <ManagedApplicationPlanDialog
        job={twentyDestroyJob}
        open
        onOpenChange={vi.fn()}
      />,
    );

    const approveButton = screen.getByRole("button", {
      name: /destroy application and data/i,
    });
    expect((approveButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/CRM database, uploaded files, cache, runtime/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText(/acknowledge destructive data impact/i),
    );
    fireEvent.change(screen.getByLabelText(/destructive confirmation/i), {
      target: { value: "DESTROY TWENTY" },
    });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith({
        input: {
          jobId: "job-twenty",
          planDigest: "sha256:plan-twenty",
          manifestDigest: "sha256:manifest",
          destructiveConfirmation: "DESTROY TWENTY",
        },
      });
    });
  });

  it("enables approval when a planning job refreshes to awaiting approval", async () => {
    const onJobChanged = vi.fn();
    useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
      if (query === queryDocs.SettingsManagedApplicationDeploymentQuery) {
        return [
          {
            data: { managedApplicationDeployment: n8nReadyJob },
            fetching: false,
          },
          refreshJobMock,
        ];
      }
      return [
        {
          data: {
            deploymentEvidence: {
              jobId: n8nReadyJob.id,
              bucket: "tw-evidence",
              prefix: "plans/n8n",
              urls: [],
            },
          },
          fetching: false,
        },
        vi.fn(),
      ];
    });

    render(
      <ManagedApplicationPlanDialog
        job={n8nPlanningJob}
        open
        onOpenChange={vi.fn()}
        onJobChanged={onJobChanged}
      />,
    );

    expect(screen.getByText("awaiting_approval")).toBeTruthy();
    const approveButton = screen.getByRole("button", {
      name: /deploy application/i,
    });
    expect((approveButton as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => {
      expect(onJobChanged).toHaveBeenCalledWith(n8nReadyJob);
    });
  });
});

const twentyDestroyJob = {
  __typename: "ManagedApplicationDeploymentJob" as const,
  id: "job-twenty",
  appKey: "twenty",
  operation: "DESTROY",
  status: "awaiting_approval",
  releaseVersion: "2026.06.06",
  manifestDigest: "sha256:manifest",
  desiredConfigVersion: "v1",
  stateMachineArn: "arn:aws:states:workflow",
  planExecutionArn: "arn:aws:states:plan",
  applyExecutionArn: null,
  codebuildBuildArn: null,
  planDigest: "sha256:plan-twenty",
  planSummary: "Destroy Twenty CRM runtime and data.",
  dataImpact: {
    destructive: true,
    summary:
      "CRM database, uploaded files, cache, runtime resources, and generated secrets will be deleted.",
    resources: ["twenty database", "twenty file bucket", "twenty app secrets"],
  },
  evidenceBucket: "tw-evidence",
  evidencePrefix: "plans/twenty",
  approvalRequired: true,
  approvedAt: null,
  rejectedAt: null,
  errorMessage: null,
  createdAt: "2026-06-06T12:00:00Z",
  updatedAt: "2026-06-06T12:00:00Z",
  events: [],
};

const n8nPlanningJob = {
  __typename: "ManagedApplicationDeploymentJob" as const,
  id: "job-n8n",
  appKey: "n8n",
  operation: "ENABLE",
  status: "planning",
  releaseVersion: "v0.1.0-canary.294",
  manifestDigest: "sha256:manifest",
  desiredConfigVersion: "v1",
  stateMachineArn: "arn:aws:states:workflow",
  planExecutionArn: "arn:aws:states:plan",
  applyExecutionArn: null,
  codebuildBuildArn: null,
  planDigest: null,
  planSummary: null,
  dataImpact: {
    destructive: false,
    summary: "No destructive n8n teardown requested.",
    resources: [],
  },
  evidenceBucket: "tw-evidence",
  evidencePrefix: "plans/n8n",
  approvalRequired: true,
  approvedAt: null,
  rejectedAt: null,
  errorMessage: null,
  createdAt: "2026-06-30T16:11:00Z",
  updatedAt: "2026-06-30T16:11:00Z",
  events: [],
};

const n8nReadyJob = {
  ...n8nPlanningJob,
  status: "awaiting_approval",
  planDigest: "sha256:plan-n8n",
  planSummary: "Deploy n8n runtime.",
  updatedAt: "2026-06-30T16:12:00Z",
};
