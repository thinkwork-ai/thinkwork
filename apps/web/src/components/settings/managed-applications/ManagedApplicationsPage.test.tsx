import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, startPlanMock, useQueryMock } = vi.hoisted(() => ({
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsManagedApplicationDeploymentQuery: Symbol("deploymentJob"),
    SettingsManagedApplicationsQuery: Symbol("managedApplications"),
    SettingsStartManagedApplicationPlanMutation: Symbol("startPlan"),
    SettingsApproveManagedApplicationDeploymentMutation: Symbol("approve"),
    SettingsRejectManagedApplicationDeploymentMutation: Symbol("reject"),
    SettingsDeploymentEvidenceQuery: Symbol("evidence"),
  },
  startPlanMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsStartManagedApplicationPlanMutation) {
      return [{ fetching: false }, startPlanMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

import { ManagedApplicationsPage } from "./ManagedApplicationsPage";

beforeEach(() => {
  startPlanMock.mockReset();
  startPlanMock.mockResolvedValue({
    data: {
      startManagedApplicationPlan: cogneePlanJob,
    },
  });
  useQueryMock.mockImplementation(({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsManagedApplicationsQuery) {
      return [
        { data: { managedApplications: managedApps }, fetching: false },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsDeploymentStatusQuery) {
      return [
        { data: { deploymentStatus: deploymentStatus }, fetching: false },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsManagedApplicationDeploymentQuery) {
      return [
        {
          data: { managedApplicationDeployment: cogneePlanJob },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsDeploymentEvidenceQuery) {
      return [
        {
          data: {
            deploymentEvidence: {
              jobId: cogneePlanJob.id,
              bucket: "tw-evidence",
              prefix: "plans/cognee",
              urls: ["https://evidence.example.com/plan.txt"],
            },
          },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
});

afterEach(cleanup);

describe("ManagedApplicationsPage", () => {
  it("drills into the Cognee Application page from the Cognee row", () => {
    render(<ManagedApplicationsPage />);

    expect(
      screen.getByRole("link", { name: /open cognee/i }).getAttribute("href"),
    ).toBe("/settings/applications/cognee");
  });

  it("starts a Cognee deploy plan and opens the plan preview", async () => {
    render(<ManagedApplicationsPage />);

    fireEvent.click(screen.getByRole("button", { name: /plan deploy/i }));

    await waitFor(() => {
      expect(startPlanMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          key: "cognee",
          operation: "ENABLE",
          desiredConfigVersion: "v1",
          desiredConfig: {},
        }),
      });
    });
    expect(await screen.findByText("Cognee ENABLE")).toBeTruthy();
    expect(screen.getByText("sha256:plan-cognee")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /evidence 1/i }).getAttribute("href"),
    ).toBe("https://evidence.example.com/plan.txt");
  });
});

const managedApps = [
  {
    __typename: "ManagedApplication",
    id: "app-cognee",
    key: "cognee",
    displayName: "Cognee",
    desiredStatus: "disabled",
    currentStatus: "disabled",
    selectedReleaseVersion: "2026.06.06",
    selectedManifestDigest: "sha256:manifest",
    lastJobId: null,
    updatedAt: "2026-06-06T12:00:00Z",
  },
];

const deploymentStatus = {
  __typename: "DeploymentStatus",
  managedApplications: [
    {
      __typename: "ManagedApplicationDeployment",
      key: "cognee",
      displayName: "Cognee",
      description: "Knowledge Graph service.",
      status: "disabled",
      enabled: false,
      provisioned: false,
      runtimeEnabled: false,
      url: null,
      endpoint: null,
      backendMode: null,
      logGroupName: null,
      logGroupNames: [],
      clusterArn: null,
      serviceName: null,
      serviceNames: [],
      albArn: null,
      targetGroupArn: null,
      message: "Cognee is not running.",
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
    },
  ],
};

const cogneePlanJob = {
  __typename: "ManagedApplicationDeploymentJob",
  id: "job-cognee",
  appKey: "cognee",
  operation: "ENABLE",
  status: "awaiting_approval",
  releaseVersion: "2026.06.06",
  manifestDigest: "sha256:manifest",
  desiredConfigVersion: "v1",
  stateMachineArn: "arn:aws:states:workflow",
  planExecutionArn: "arn:aws:states:plan",
  applyExecutionArn: null,
  codebuildBuildArn: null,
  planDigest: "sha256:plan-cognee",
  planSummary: "Deploy Cognee runtime.",
  dataImpact: { destructive: false },
  evidenceBucket: "tw-evidence",
  evidencePrefix: "plans/cognee",
  approvalRequired: true,
  approvedAt: null,
  rejectedAt: null,
  errorMessage: null,
  createdAt: "2026-06-06T12:00:00Z",
  updatedAt: "2026-06-06T12:00:00Z",
  events: [
    {
      __typename: "ManagedApplicationDeploymentEvent",
      id: "event-1",
      eventType: "plan_ready",
      message: "Plan ready for approval.",
      payload: null,
      createdAt: "2026-06-06T12:00:00Z",
    },
  ],
};
