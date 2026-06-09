import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDeploymentStatusQuery } from "@/gql/graphql";

const {
  installMcpMock,
  queryDocs,
  runHealthCheckMock,
  useMutationMock,
  useQueryMock,
} = vi.hoisted(() => ({
  installMcpMock: vi.fn(),
  queryDocs: {
    SettingsDeploymentStatusQuery: Symbol("deploymentStatus"),
    SettingsManagedApplicationHealthCheckQuery: Symbol("healthCheck"),
    SettingsInstallManagedApplicationMcpServerMutation: Symbol("installMcp"),
  },
  runHealthCheckMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/SettingsKestraApplication.tsx",
  ),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.applications.kestra.tsx"),
  "utf8",
);

import { SettingsKestraApplication } from "./SettingsKestraApplication";

beforeEach(() => {
  installMcpMock.mockReset();
  runHealthCheckMock.mockReset();
  useMutationMock.mockReset();
  useQueryMock.mockReset();
  useMutationMock.mockReturnValue([
    { fetching: false },
    installMcpMock.mockResolvedValue({
      data: {
        installManagedApplicationMcpServer: {
          message: "Kestra control MCP server registered.",
        },
      },
    }),
  ]);
});

afterEach(cleanup);

describe("SettingsKestraApplication", () => {
  it("renders Kestra operational details and v1 limitations", () => {
    expect(source).toContain("Kestra orchestration deployment");
    expect(source).toContain("Supported runtime");
    expect(source).toContain("Unsupported execution");
    expect(source).toContain("Namespace policy");
    expect(source).toContain("SettingsManagedApplicationHealthCheckQuery");
    expect(source).toContain('variables: { key: "kestra" }');
    expect(source).toContain(
      "SettingsInstallManagedApplicationMcpServerMutation",
    );
  });

  it("allows operators to open the page before Kestra is deployed", () => {
    expect(routeSource).toContain("ManagedApplicationRouteGuard");
    expect(routeSource).toContain('appKey="kestra"');
    expect(routeSource).toContain("allowDisabled");
    expect(routeSource).toContain("<SettingsKestraApplication");
  });

  it("shows Kestra runtime metadata and lifecycle link", () => {
    mockDeployment(deploymentWithKestraRunning);

    render(<SettingsKestraApplication />);

    expect(screen.getByText("Kestra")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("kestra-dev-internal")).toBeTruthy();
    expect(screen.getByText("thinkwork_kestra")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /manage/i })
        .at(-1)
        ?.getAttribute("href"),
    ).toBe("/settings/managed-applications");
  });

  it("installs or repairs the Kestra control MCP row from the app page", async () => {
    mockDeployment(deploymentWithKestraRunning);

    render(<SettingsKestraApplication />);

    fireEvent.click(
      await screen.findByRole("button", { name: /install mcp server/i }),
    );

    await waitFor(() => {
      expect(installMcpMock).toHaveBeenCalledWith({ key: "kestra" });
    });
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

const deploymentWithKestraRunning = {
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
      key: "kestra",
      displayName: "Kestra",
      description: "Workflow orchestration runtime managed by ThinkWork.",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://orchestrate.example.com",
      endpoint: "https://orchestrate.example.com",
      backendMode: null,
      logGroupName: "/thinkwork/dev/kestra",
      logGroupNames: ["/thinkwork/dev/kestra"],
      clusterArn: "arn:aws:ecs:cluster/kestra",
      serviceName: "thinkwork-dev-kestra-service",
      serviceNames: ["thinkwork-dev-kestra-service"],
      albArn: "arn:aws:elasticloadbalancing:alb/kestra",
      targetGroupArn: "arn:aws:elasticloadbalancing:targetgroup/kestra",
      storageBucketName: "kestra-dev-internal",
      databaseName: "thinkwork_kestra",
      message: null,
      managedMcpServerId: null,
      managedMcpStatus: "missing",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: true,
      managedMcpMessage:
        "Kestra control MCP server has not been registered yet.",
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];
