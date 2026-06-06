import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SettingsDeploymentStatusQuery } from "@/gql/graphql";
import { ManagedApplicationsSection } from "./ManagedApplicationsSection";

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

afterEach(cleanup);

describe("ManagedApplicationsSection", () => {
  it("keeps General as an overview instead of direct lifecycle controls", () => {
    expect(source).toContain('SettingsSection label="Managed Applications"');
    expect(source).toContain('to="/settings/managed-applications"');
    expect(source).not.toContain(
      "SettingsSetManagedApplicationDeploymentMutation",
    );
    expect(source).not.toContain("Switch");
    expect(source).not.toContain("localStorage");
    expect(queries).toContain("managedApplications {");
  });

  it("renders Cognee and Twenty status with a manage link", () => {
    render(
      <ManagedApplicationsSection
        deployment={deploymentWithTwentyEnabled}
        loading={false}
      />,
    );

    expect(screen.getByText("Cognee")).toBeTruthy();
    expect(screen.getByText("Twenty CRM")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /manage/i }).getAttribute("href"),
    ).toBe("/settings/managed-applications");
    expect(
      screen
        .getByRole("link", { name: /open twenty crm/i })
        .getAttribute("href"),
    ).toBe("https://crm.example.com");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /destroy/i })).toBeNull();
  });

  it("shows unavailable status without rendering action buttons", () => {
    render(<ManagedApplicationsSection unavailable />);

    expect(
      screen.getByText("Managed application status unavailable."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /manage/i })).toBeNull();
  });
});

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
      managedMcpServerId: null,
      managedMcpStatus: "not_applicable",
      managedMcpInstalled: false,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
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
      managedMcpServerId: "mcp-1",
      managedMcpStatus: "installed",
      managedMcpInstalled: true,
      managedMcpInstallAvailable: false,
      managedMcpMessage: null,
    },
  ],
} as SettingsDeploymentStatusQuery["deploymentStatus"];
