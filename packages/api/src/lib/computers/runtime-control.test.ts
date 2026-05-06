import { describe, expect, it } from "vitest";
import {
  buildCreateServiceInput,
  buildTaskDefinitionInput,
  computerServiceName,
  computerWorkspacePath,
} from "./runtime-control.js";

const CONFIG = {
  stage: "prod",
  region: "us-east-1",
  clusterName: "thinkwork-prod-computer",
  efsFileSystemId: "fs-123",
  subnetIds: ["subnet-a", "subnet-b"],
  taskSecurityGroupId: "sg-task",
  executionRoleArn: "arn:aws:iam::123:role/execution",
  taskRoleArn: "arn:aws:iam::123:role/task",
  logGroupName: "/thinkwork/prod/computer-runtime",
  repositoryUrl: "123.dkr.ecr.us-east-1.amazonaws.com/computer-runtime",
  apiUrl: "https://api.thinkwork.ai/graphql",
  apiSecret: "service-secret",
  image: "123.dkr.ecr.us-east-1.amazonaws.com/computer-runtime:phase2-skeleton",
  runtimeVersion: "phase2-skeleton",
  defaultCpu: 256,
  defaultMemory: 512,
};

describe("computer runtime control builders", () => {
  it("derives deterministic service and workspace names", () => {
    expect(
      computerServiceName("prod", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    ).toBe("thinkwork-prod-computer-aaaaaaaabbbbccccddddeeee");
    expect(
      computerWorkspacePath(
        "11111111-2222-3333-4444-555555555555",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe(
      "/tenants/11111111-2222-3333-4444-555555555555/computers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("builds a Fargate ARM64 task definition with EFS workspace mounted", () => {
    const taskDefinition = buildTaskDefinitionInput({
      config: CONFIG,
      tenantId: "11111111-2222-3333-4444-555555555555",
      computerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      accessPointId: "fsap-123",
      workspaceRoot:
        "/tenants/11111111-2222-3333-4444-555555555555/computers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    expect(taskDefinition).toMatchObject({
      family: "thinkwork-prod-computer-aaaaaaaabbbbccccddddeeee",
      requiresCompatibilities: ["FARGATE"],
      networkMode: "awsvpc",
      cpu: "256",
      memory: "512",
      runtimePlatform: {
        operatingSystemFamily: "LINUX",
        cpuArchitecture: "ARM64",
      },
      volumes: [
        {
          name: "workspace",
          efsVolumeConfiguration: {
            fileSystemId: "fs-123",
            transitEncryption: "ENABLED",
            authorizationConfig: {
              accessPointId: "fsap-123",
              iam: "DISABLED",
            },
          },
        },
      ],
    });
    expect(taskDefinition.containerDefinitions?.[0]).toMatchObject({
      name: "computer-runtime",
      image:
        "123.dkr.ecr.us-east-1.amazonaws.com/computer-runtime:phase2-skeleton",
      mountPoints: [
        {
          sourceVolume: "workspace",
          containerPath: "/workspace",
          readOnly: false,
        },
      ],
    });
  });

  it("builds a private ECS service using the Computer runtime task security group", () => {
    expect(
      buildCreateServiceInput({
        clusterName: "thinkwork-prod-computer",
        serviceName: "thinkwork-prod-computer-aaaa",
        taskDefinitionArn: "arn:aws:ecs:task-definition/computer:1",
        subnetIds: ["subnet-a", "subnet-b"],
        taskSecurityGroupId: "sg-task",
      }),
    ).toMatchObject({
      cluster: "thinkwork-prod-computer",
      serviceName: "thinkwork-prod-computer-aaaa",
      desiredCount: 1,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ["subnet-a", "subnet-b"],
          securityGroups: ["sg-task"],
          assignPublicIp: "DISABLED",
        },
      },
    });
  });
});
