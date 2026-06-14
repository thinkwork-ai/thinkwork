import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryDocs,
  useQueryMock,
  startPreflightMock,
  remediateRunnerMock,
  startReleaseUpdateMock,
  refreshReleaseJobMock,
} = vi.hoisted(() => ({
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsDeploymentReleasesQuery: Symbol("deploymentReleases"),
    SettingsReleaseUpdateJobQuery: Symbol("releaseUpdateJob"),
    SettingsRemediateReleaseRunnerMutation: Symbol("remediateRunner"),
    SettingsStartDeploymentReleaseUpdateMutation: Symbol("startReleaseUpdate"),
    SettingsStartReleaseUpdatePreflightMutation: Symbol("startPreflight"),
  },
  useQueryMock: vi.fn(),
  startPreflightMock: vi.fn(),
  remediateRunnerMock: vi.fn(),
  startReleaseUpdateMock: vi.fn(),
  refreshReleaseJobMock: vi.fn(),
}));

const useTenantMock = vi.hoisted(() => vi.fn());

vi.mock("urql", () => ({
  useMutation: (query: symbol) => {
    if (query === queryDocs.SettingsStartReleaseUpdatePreflightMutation) {
      return [{ fetching: false }, startPreflightMock];
    }
    if (query === queryDocs.SettingsRemediateReleaseRunnerMutation) {
      return [{ fetching: false }, remediateRunnerMock];
    }
    return [{ fetching: false }, startReleaseUpdateMock];
  },
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/TenantContext", () => ({
  useTenant: useTenantMock,
}));

vi.mock("@/lib/desktop-detection", () => ({
  isDesktop: () => false,
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
  useTenantMock.mockReturnValue({ isOperator: true, roleResolved: true });
  startPreflightMock.mockReset().mockResolvedValue({
    data: { startReleaseUpdatePreflight: releaseJob() },
  });
  remediateRunnerMock.mockReset().mockResolvedValue({
    data: {
      remediateReleaseRunner: releaseJob({ status: "runner_remediated" }),
    },
  });
  startReleaseUpdateMock.mockReset().mockResolvedValue({
    data: {
      startDeploymentReleaseUpdate: releaseJob({
        status: "updating",
        executionArn:
          "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment:release-134",
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
        evidenceBucket: "thinkwork-dev-evidence",
        evidencePrefix: "release-updates/job-1/update",
      }),
    },
  });
  refreshReleaseJobMock.mockReset();
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
    if (query === queryDocs.SettingsReleaseUpdateJobQuery) {
      return [
        { data: { releaseUpdateJob: null }, fetching: false },
        refreshReleaseJobMock,
      ];
    }
    return [{ fetching: false }, vi.fn()];
  });
});

afterEach(cleanup);

describe("SettingsGeneral releases", () => {
  it("hides deployment, resources, and releases for non-operators", () => {
    useTenantMock.mockReturnValue({ isOperator: false, roleResolved: true });

    render(<SettingsGeneral />);

    expect(screen.queryByText("Deployment")).toBeNull();
    expect(screen.queryByText("Resources & URLs")).toBeNull();
    expect(screen.queryByText("Deployed release")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: queryDocs.SettingsDeploymentStatusQuery,
        pause: true,
      }),
    );
    expect(useQueryMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        query: queryDocs.SettingsDeploymentReleasesQuery,
      }),
    );
  });

  it("shows deployed platform release in deployment details", () => {
    render(<SettingsGeneral />);

    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByText("App build")).toBeNull();
    expect(screen.getByText("Deployed release")).toBeTruthy();
    expect(screen.getByText("v0.1.0-canary.152")).toBeTruthy();
    expect(screen.getByText("Manifest SHA")).toBeTruthy();
    expect(screen.getByText("c".repeat(64))).toBeTruthy();
  });

  it("runs preflight and shows preserved customer config before dispatch", async () => {
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Review release?")).toBeTruthy();
    expect(screen.getAllByText("v0.1.0-canary.134").length).toBeGreaterThan(1);
    expect(screen.getByText("a".repeat(64))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run Preflight" }));

    expect(startPreflightMock).toHaveBeenCalledWith({
      input: {
        version: "v0.1.0-canary.134",
        manifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
        manifestSha256: "a".repeat(64),
        signatureUrl: null,
        signed: false,
        idempotencyKey: "settings-release-preflight-v0.1.0-canary.134",
      },
    });
    expect(await screen.findByText("Release ready for dispatch")).toBeTruthy();
    expect(screen.getByText("customer.example.com")).toBeTruthy();
    expect(screen.getByText("ops@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Update" })).toBeTruthy();
  });

  it("offers safe runner refresh when preflight requires it", async () => {
    startPreflightMock.mockResolvedValueOnce({
      data: {
        startReleaseUpdatePreflight: releaseJob({
          status: "preflight_blocked",
          preflightSummary: {
            blocked: true,
            blockers: [
              {
                category: "runner_compatibility",
                message: "The frozen S3 deployment runner does not match.",
                recoveryAction: "Refresh the S3 runner.",
              },
            ],
            warnings: [],
            runner: { status: "mismatch" },
            iam: { status: "ok" },
          },
          remediationSummary: {
            runnerRefresh: { required: true },
          },
          recoveryAction: "Refresh the S3 runner.",
        }),
      },
    });
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Preflight" }));

    expect(
      await screen.findByText("Release checks need attention"),
    ).toBeTruthy();
    expect(screen.getAllByText(/Refresh the S3 runner/).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh Runner" }));

    expect(remediateRunnerMock).toHaveBeenCalledWith({
      input: {
        jobId: "job-1",
        idempotencyKey: "settings-release-runner-job-1",
      },
    });
    expect(await screen.findByText("Release ready for dispatch")).toBeTruthy();
  });

  it("dispatches a reviewed job and shows execution evidence", async () => {
    render(<SettingsGeneral />);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Preflight" }));
    expect(await screen.findByText("Release ready for dispatch")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start Update" }));

    expect(startReleaseUpdateMock).toHaveBeenCalledWith({
      input: {
        jobId: "job-1",
        idempotencyKey: "settings-release-dispatch-job-1",
      },
    });
    expect(
      await screen.findByText("Deployment controller running"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment:release-134",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("thinkwork-dev-evidence/release-updates/job-1/update"),
    ).toBeTruthy();
  });
});

function releaseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    status: "preflight_ready",
    targetReleaseVersion: "v0.1.0-canary.134",
    currentReleaseVersion: "v0.1.0-canary.152",
    manifestSha256: "a".repeat(64),
    manifestSigned: false,
    manifestTrustPolicy: "allow_unsigned_canary",
    terraformModuleVersion: "0.1.0-canary.134",
    preflightSummary: {
      blocked: false,
      blockers: [],
      warnings: [],
      runner: { status: "compatible" },
      iam: { status: "ok" },
    },
    preservedConfigSummary: {
      available: true,
      fields: {
        customerDomain: "customer.example.com",
        customerDomainDelegated: true,
        customerDomainLegacyRetired: false,
        sesSender: {
          cognitoFromEmailAddress: "ThinkWork <noreply@example.com>",
        },
        platformOperatorEmails: "ops@example.com",
        googleOauthClientIdConfigured: true,
        optionalApps: {
          hindsight: true,
          cognee: false,
          twenty: false,
        },
      },
    },
    remediationSummary: {
      runnerRefresh: { required: false },
    },
    stateMachineArn:
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment",
    executionArn: null,
    codebuildBuildArn: null,
    evidenceBucket: "thinkwork-dev-evidence",
    evidencePrefix: "release-updates/job-1/preflight",
    statusPointerBucket: "thinkwork-dev-evidence",
    statusPointerKey: "deployment/status/current.json",
    finalStatus: {},
    failureCategory: null,
    failureMessage: null,
    recoveryAction: null,
    events: [],
    ...overrides,
  };
}

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
