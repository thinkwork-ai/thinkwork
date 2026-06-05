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

afterEach(cleanup);

describe("ManagedApplicationsSection", () => {
  it("renders Cognee and Twenty as managed applications in General", () => {
    expect(source).toContain('SettingsSection label="Managed Applications"');
    expect(source).toContain("Cognee");
    expect(source).toContain("Twenty CRM");
    expect(source).toContain("SettingsSetManagedApplicationDeploymentMutation");
  });

  it("uses retained-data semantics for Twenty disable", () => {
    expect(source).toContain("Park Twenty CRM?");
    expect(source).toContain("retaining the dedicated database");
    expect(source).toContain("CRM settings remain hidden");
    expect(queries).toContain("setManagedApplicationDeployment");
    expect(queries).toContain("managedApplications {");
  });

  it("confirms parking Twenty before queuing the retained-data disable", async () => {
    render(
      <ManagedApplicationsSection
        deployment={deploymentWithTwentyEnabled}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByLabelText("Toggle Twenty CRM"));
    expect(screen.getByText("Park Twenty CRM?")).toBeTruthy();
    expect(screen.getByText(/retaining the dedicated database/)).toBeTruthy();

    fireEvent.click(screen.getByText("Park"));

    await waitFor(() =>
      expect(setDeploymentMock).toHaveBeenCalledWith({
        key: "twenty",
        enabled: false,
      }),
    );
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
