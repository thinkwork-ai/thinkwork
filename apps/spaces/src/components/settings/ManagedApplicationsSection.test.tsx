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
import { ManagedApplicationDeploymentAction } from "@/gql/graphql";

const { setDeploymentMock, queryDocs } = vi.hoisted(() => ({
  setDeploymentMock: vi.fn(),
  queryDocs: {
    SettingsSetManagedApplicationDeploymentMutation: Symbol("setManagedApp"),
  },
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, setDeploymentMock],
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/ManagedApplicationsSection.tsx",
  ),
  "utf8",
);
const queries = readFileSync(
  resolve(process.cwd(), "src/lib/settings-queries.ts"),
  "utf8",
);

import { ManagedApplicationsSection } from "./ManagedApplicationsSection";

beforeEach(() => {
  setDeploymentMock.mockReset();
  setDeploymentMock.mockResolvedValue({
    data: {
      setManagedApplicationDeployment: {
        message: "Twenty CRM deployment queued.",
      },
    },
  });
});

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe("ManagedApplicationsSection", () => {
  it("renders Cognee and Twenty as managed applications in General", () => {
    expect(source).toContain('SettingsSection label="Managed Applications"');
    expect(source).toContain("Cognee");
    expect(source).toContain("Twenty CRM");
    expect(source).toContain("SettingsSetManagedApplicationDeploymentMutation");
  });

  it("keeps destructive lifecycle controls off the General managed app row", () => {
    expect(source).toContain('to="/settings/crm"');
    expect(source).toContain("<ManagedApplicationLabel app={app} />");
    expect(source).not.toContain("Configure");
    expect(source).not.toContain("TwentyLifecycleControls");
    expect(source).not.toContain("Park Twenty CRM?");
    expect(source).not.toContain("Destroy Twenty CRM and delete data?");
    expect(queries).toContain("managedApplications {");
  });

  it("renders an enable switch for disabled Twenty CRM with a CRM settings link", async () => {
    render(
      <ManagedApplicationsSection
        deployment={deploymentWithTwentyDisabled}
        loading={false}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Twenty CRM" }).getAttribute("href"),
    ).toBe("/settings/crm");
    expect(screen.queryByRole("link", { name: /configure/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: /toggle twenty crm/i }));

    expect(setDeploymentMock).toHaveBeenCalledWith({
      key: "twenty",
      action: ManagedApplicationDeploymentAction.Enable,
    });
    expect(
      window.localStorage.getItem(
        "thinkwork:dev:managed-app:twenty:pending-action",
      ),
    ).toContain(ManagedApplicationDeploymentAction.Enable);
    await waitFor(() => {
      expect(screen.getByText("deploying")).toBeTruthy();
    });
  });

  it("renders the CRM settings and external links for provisioned Twenty CRM", () => {
    render(
      <ManagedApplicationsSection
        deployment={deploymentWithTwentyEnabled}
        loading={false}
      />,
    );

    expect(screen.queryByRole("link", { name: /configure/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Twenty CRM" }).getAttribute("href"),
    ).toBe("/settings/crm");
    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("https://crm.example.com");
    expect(screen.queryByRole("button", { name: /deploy/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /park/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /destroy/i })).toBeNull();
  });

  it("restores deploying state after refresh while the backend still reports disabled", async () => {
    window.localStorage.setItem(
      "thinkwork:dev:managed-app:twenty:pending-action",
      JSON.stringify({ action: "ENABLE", createdAt: Date.now() }),
    );

    render(
      <ManagedApplicationsSection
        deployment={deploymentWithTwentyDisabled}
        loading={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("deploying")).toBeTruthy();
    });
    expect(
      screen
        .getByRole("switch", { name: /toggle twenty crm/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByRole("link", { name: /configure/i })).toBeNull();
  });
});

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
  apiEndpoint: null,
  appsyncUrl: null,
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
      key: "cognee",
      displayName: "Cognee",
      description: "Knowledge Graph service for ontology and graph retrieval.",
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
      message: null,
    },
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
      message: "Twenty CRM has not been provisioned for this stage.",
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];

const deploymentWithTwentyEnabled = {
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
  apiEndpoint: null,
  appsyncUrl: null,
  cogneeEnabled: false,
  cogneeEndpoint: null,
  cogneeBackendMode: null,
  cogneeClusterArn: null,
  cogneeServiceName: null,
  cogneeLogGroupName: null,
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
      key: "cognee",
      displayName: "Cognee",
      description: "Knowledge Graph service for ontology and graph retrieval.",
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
      message: null,
    },
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
      message: "Twenty CRM is running.",
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];
