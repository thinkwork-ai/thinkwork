import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryDocs, useQueryMock, startReleaseUpdateMock } = vi.hoisted(() => ({
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsDeploymentReleasesQuery: Symbol("deploymentReleases"),
    SettingsStartDeploymentReleaseUpdateMutation: Symbol("startReleaseUpdate"),
  },
  useQueryMock: vi.fn(),
  startReleaseUpdateMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, startReleaseUpdateMock],
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ isOperator: true, roleResolved: true }),
}));

vi.mock("@/lib/desktop-detection", () => ({
  isDesktop: () => false,
}));

vi.mock("@/lib/app-version", () => ({
  APP_VERSION_LABEL: "v0.1.0-test",
}));

vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@thinkwork/ui")>();
  return {
    ...actual,
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  };
});

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

import { SettingsGeneral } from "./SettingsGeneral";

beforeEach(() => {
  useQueryMock.mockReset();
  startReleaseUpdateMock.mockReset().mockResolvedValue({
    data: {
      startDeploymentReleaseUpdate: {
        executionArn:
          "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment:release-134",
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
        evidenceBucket: "thinkwork-dev-evidence",
        evidencePrefix: "settings/releases/v0.1.0-canary.134/run-1",
        message: "Deployment update requested for v0.1.0-canary.134.",
        release: {
          version: "v0.1.0-canary.134",
          manifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
          manifestSha256: "a".repeat(64),
          signed: false,
          deployable: true,
        },
      },
    },
  });
  useQueryMock.mockImplementation(({ query }: { query: symbol }) => {
    if (query === queryDocs.SettingsDeploymentStatusQuery) {
      return [
        { data: { deploymentStatus: deployment }, fetching: false },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsDeploymentReleasesQuery) {
      return [
        {
          data: {
            deploymentReleases: [
              {
                version: "v0.1.0-canary.134",
                name: "v0.1.0-canary.134",
                prerelease: true,
                draft: false,
                publishedAt: "2026-06-09T12:00:00Z",
                htmlUrl:
                  "https://github.com/thinkwork-ai/thinkwork/releases/tag/v0.1.0-canary.134",
                manifestUrl:
                  "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
                manifestSha256: "a".repeat(64),
                signatureUrl: null,
                signed: false,
                deployable: true,
              },
            ],
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

describe("SettingsGeneral releases", () => {
  it("shows app build and deployed platform release in deployment details", () => {
    render(<SettingsGeneral />);

    expect(screen.queryByText("About")).toBeNull();
    expect(screen.getByText("App build")).toBeTruthy();
    expect(screen.getByText("v0.1.0-test")).toBeTruthy();
    expect(screen.getByText("Deployed release")).toBeTruthy();
    expect(screen.getByText("v0.1.0-canary.152")).toBeTruthy();
    expect(screen.getByText("Manifest SHA")).toBeTruthy();
    expect(screen.getByText("c".repeat(64))).toBeTruthy();
  });

  it("confirms a selected release before starting deployment", async () => {
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Deploy release?")).toBeTruthy();
    expect(screen.getAllByText("v0.1.0-canary.134").length).toBeGreaterThan(1);
    expect(screen.getByText("a".repeat(64))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Deploy" }));

    await waitFor(() =>
      expect(startReleaseUpdateMock).toHaveBeenCalledWith({
        input: {
          version: "v0.1.0-canary.134",
          manifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
          manifestSha256: "a".repeat(64),
          idempotencyKey: "settings-release-v0.1.0-canary.134",
        },
      }),
    );
    expect(
      await screen.findByText("Deployment controller started"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment:release-134",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "thinkwork-dev-evidence/settings/releases/v0.1.0-canary.134/run-1",
      ),
    ).toBeTruthy();
  });

  it("shows inline deployment progress immediately after confirmation", async () => {
    startReleaseUpdateMock.mockReturnValueOnce(new Promise(() => undefined));
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deploy" }));

    expect(
      await screen.findByText("Starting deployment controller"),
    ).toBeTruthy();
    expect(screen.getByText("Submit release request")).toBeTruthy();
    expect(screen.getByText("in progress")).toBeTruthy();
    expect(screen.getAllByText("v0.1.0-canary.134").length).toBeGreaterThan(1);
  });

  it("shows the deployment API error inline", async () => {
    startReleaseUpdateMock.mockResolvedValueOnce({
      error: { message: "Deployment controller is not configured." },
    });
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Deploy" }));

    expect(
      await screen.findByText(
        "Deployment failed before the controller started",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Deployment controller is not configured."),
    ).toBeTruthy();
  });
});

const deployment = {
  __typename: "DeploymentStatus",
  stage: "dev",
  source: "AWS",
  region: "us-east-1",
  accountId: "123456789012",
  releaseVersion: "v0.1.0-canary.152",
  releaseManifestUrl:
    "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.152/thinkwork-release.json",
  releaseManifestSha256: "c".repeat(64),
  deploymentControllerArn:
    "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
  deploymentRunnerProjectName: "thinkwork-dev-deployment-runner",
  deploymentEvidenceBucket: "thinkwork-dev-evidence",
  agentcoreStatus: "ready",
  hindsightEnabled: false,
  managedMemoryEnabled: true,
  bucketName: "bucket",
  databaseEndpoint: "db.example.com",
  ecrUrl: "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork",
  adminUrl: null,
  docsUrl: null,
  apiEndpoint: "https://api.example.com",
  appsyncUrl: "https://appsync.example.com/graphql",
  appsyncRealtimeUrl: "wss://appsync.example.com/graphql",
  hindsightEndpoint: null,
  cogneeEnabled: false,
  cogneeEndpoint: null,
  cogneeBackendMode: null,
  cogneeClusterArn: null,
  cogneeServiceName: null,
  cogneeLogGroupName: null,
  twentyProvisioned: false,
  twentyRuntimeEnabled: false,
  twentyUrl: null,
  twentyClusterArn: null,
  twentyServerServiceName: null,
  twentyWorkerServiceName: null,
  twentyServerLogGroupName: null,
  twentyWorkerLogGroupName: null,
  twentyAlbArn: null,
  twentyTargetGroupArn: null,
  managedApplications: [],
};
