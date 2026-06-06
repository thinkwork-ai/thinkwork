import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approveMock, queryDocs, rejectMock, useQueryMock } = vi.hoisted(() => ({
  approveMock: vi.fn(),
  queryDocs: {
    SettingsApproveManagedApplicationDeploymentMutation: Symbol("approve"),
    SettingsRejectManagedApplicationDeploymentMutation: Symbol("reject"),
    SettingsDeploymentEvidenceQuery: Symbol("evidence"),
  },
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
  useQueryMock.mockReturnValue([
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
  ]);
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
