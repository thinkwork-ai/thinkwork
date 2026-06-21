import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDeploymentStatusQuery } from "@/gql/graphql";

const { queryDocs, runHealthCheckMock, setDeploymentMock, useQueryMock } =
  vi.hoisted(() => ({
    queryDocs: {
      SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
      SettingsManagedApplicationHealthCheckQuery: Symbol("healthCheck"),
      SettingsInstallManagedApplicationMcpServerMutation: Symbol("installMcp"),
    },
    runHealthCheckMock: vi.fn(),
    setDeploymentMock: vi.fn(),
    useQueryMock: vi.fn(),
  }));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, setDeploymentMock],
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const source = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsCrm.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.crm.tsx"),
  "utf8",
);

import { SettingsCrm } from "./SettingsCrm";

beforeEach(() => {
  runHealthCheckMock.mockReset();
  setDeploymentMock.mockReset();
  useQueryMock.mockReset();
});

afterEach(cleanup);

describe("SettingsCrm", () => {
  it("renders Twenty CRM operational details without SSO controls", () => {
    expect(source).toContain("Twenty CRM deployment");
    expect(source).toContain("First admin setup");
    expect(source).toContain("Twenty native first-user setup");
    expect(source).toContain("Follow-up: connect ThinkWork/Cognito SSO");
    expect(source).toContain('to="/settings/managed-applications"');
    expect(source).not.toContain(
      "SettingsSetManagedApplicationDeploymentMutation",
    );
    expect(source).not.toContain('SettingsSection label="Teardown"');
    expect(source).not.toContain("Park runtime");
    expect(source).not.toContain("Destroy Twenty CRM and delete data?");
    expect(source).toContain("SettingsManagedApplicationHealthCheckQuery");
    expect(source).toContain("managedApplicationHealthCheck");
    expect(source).toContain("Workflow readiness");
  });

  it("guards CRM configuration until Twenty has been provisioned", () => {
    expect(routeSource).toContain("ManagedApplicationRouteGuard");
    expect(routeSource).toContain('appKey="twenty"');
    expect(routeSource).toContain("requireProvisioned");
    expect(routeSource).toContain("<SettingsCrm");
  });

  it("does not show deploy or teardown controls before Twenty is provisioned", () => {
    mockDeployment(deploymentWithTwentyDisabled);

    render(<SettingsCrm />);

    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
    expect(screen.queryByText("Teardown")).toBeNull();
    expect(screen.queryByRole("button", { name: /park/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /destroy/i })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /manage deployment/i })
        .getAttribute("href"),
    ).toBe("/settings/managed-applications");
    expect(
      screen.queryByRole("button", { name: /install mcp server/i }),
    ).toBeNull();
    expect(screen.getByText("blocked_not_ready")).toBeTruthy();
  });

  it("keeps lifecycle actions on the managed applications page once provisioned", () => {
    mockDeployment(deploymentWithTwentyRunning);

    render(<SettingsCrm />);

    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
    expect(screen.queryByText("Teardown")).toBeNull();
    expect(screen.queryByRole("button", { name: /park/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /destroy/i })).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: /manage/i })
        .at(-1)
        ?.getAttribute("href"),
    ).toBe("/settings/managed-applications");
    expect(
      screen.getByRole("button", { name: /install mcp server/i }),
    ).toBeTruthy();
    expect(screen.getByText("blocked_not_ready")).toBeTruthy();
  });
});

function mockDeployment(
  deployment: SettingsDeploymentStatusQuery["deploymentStatus"],
) {
  useQueryMock.mockImplementation((options: { pause?: boolean }) => {
    if (options.pause) {
      return [{ fetching: false }, runHealthCheckMock];
    }

    return [
      { data: { deploymentStatus: deployment }, fetching: false },
      vi.fn(),
    ];
  });
}

const deploymentWithTwentyDisabled = {
  __typename: "DeploymentStatus",
  stage: "dev",
  source: "terraform",
  region: "us-east-1",
  accountId: "123456789012",
  agentcoreStatus: "ready",
  hindsightEnabled: false,
  managedMemoryEnabled: true,
  bucketName: null,
  databaseEndpoint: null,
  ecrUrl: null,
  adminUrl: null,
  docsUrl: null,
  apiEndpoint: null,
  appsyncUrl: null,
  appsyncRealtimeUrl: null,
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
  managedApplications: [
    {
      __typename: "ManagedApplicationDeployment",
      key: "twenty",
      displayName: "Twenty CRM",
      description: "Self-hosted CRM runtime managed by ThinkWork.",
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
      storageBucketName: null,
      databaseName: null,
      message: "Twenty CRM has not been provisioned for this stage.",
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
      workflowReadinessState: "blocked_not_ready",
      workflowReadinessReasons: [
        {
          code: "managed_app_destroyed",
          component: "managed_app",
          severity: "blocker",
          message:
            "Twenty CRM managed application is destroyed or disabled; workflow history remains available.",
        },
      ],
      workflowCapabilityFlags: {},
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];

const deploymentWithTwentyRunning = {
  ...deploymentWithTwentyDisabled,
  twentyProvisioned: true,
  twentyRuntimeEnabled: true,
  twentyUrl: "https://crm.example.com",
  twentyClusterArn: "arn:aws:ecs:cluster/dev",
  twentyServerServiceName: "twenty-server",
  twentyWorkerServiceName: "twenty-worker",
  twentyServerLogGroupName: "/thinkwork/dev/twenty/server",
  twentyWorkerLogGroupName: "/thinkwork/dev/twenty/worker",
  twentyAlbArn: "arn:aws:elasticloadbalancing:alb/dev",
  twentyTargetGroupArn: "arn:aws:elasticloadbalancing:targetgroup/dev",
  managedApplications: [
    {
      __typename: "ManagedApplicationDeployment",
      key: "twenty",
      displayName: "Twenty CRM",
      description: "Self-hosted CRM runtime managed by ThinkWork.",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://crm.example.com",
      endpoint: "https://crm.example.com/healthz",
      backendMode: null,
      logGroupName: null,
      logGroupNames: [
        "/thinkwork/dev/twenty/server",
        "/thinkwork/dev/twenty/worker",
      ],
      clusterArn: "arn:aws:ecs:cluster/dev",
      serviceName: null,
      serviceNames: ["twenty-server", "twenty-worker"],
      albArn: "arn:aws:elasticloadbalancing:alb/dev",
      targetGroupArn: "arn:aws:elasticloadbalancing:targetgroup/dev",
      storageBucketName: null,
      databaseName: null,
      message: "Twenty CRM is running.",
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: true,
      managedMcpMessage: "Twenty CRM MCP server has not been registered yet.",
      workflowReadinessState: "blocked_not_ready",
      workflowReadinessReasons: [
        {
          code: "mcp_server_missing",
          component: "mcp",
          severity: "blocker",
          message: "Twenty CRM MCP server is not registered for agents.",
        },
      ],
      workflowCapabilityFlags: {
        sourceSystem: "twenty",
        triggerFamilies: ["crm"],
        monitor: true,
      },
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];
