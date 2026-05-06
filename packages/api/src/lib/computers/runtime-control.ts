import {
  CreateServiceCommand,
  DescribeServicesCommand,
  ECSClient,
  type CreateServiceCommandInput,
  type RegisterTaskDefinitionCommandInput,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import { CreateAccessPointCommand, EFSClient } from "@aws-sdk/client-efs";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { computerEvents, computers } from "@thinkwork/database-pg/schema";

const ecs = new ECSClient({});
const efs = new EFSClient({});
const db = getDb();

export class ComputerRuntimeControlError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ComputerRuntimeControlError";
  }
}

export type RuntimeAction =
  | "provision"
  | "start"
  | "stop"
  | "restart"
  | "status";

export function computerServiceName(stage: string, computerId: string): string {
  return `thinkwork-${stage}-computer-${computerId.replace(/-/g, "").slice(0, 24)}`;
}

export function computerWorkspacePath(tenantId: string, computerId: string) {
  return `/tenants/${tenantId}/computers/${computerId}`;
}

export async function controlComputerRuntime(input: {
  action: RuntimeAction;
  tenantId: string;
  computerId: string;
}) {
  switch (input.action) {
    case "provision":
      return provisionComputerRuntime(input);
    case "start":
      return updateDesiredCount(input, 1, "running");
    case "stop":
      return updateDesiredCount(input, 0, "stopped");
    case "restart":
      await updateDesiredCount(input, 0, "stopped");
      return updateDesiredCount(input, 1, "running");
    case "status":
      return describeComputerRuntime(input);
  }
}

export async function provisionComputerRuntime(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  const config = runtimeConfig();
  const serviceName =
    computer.ecs_service_name ??
    computerServiceName(config.stage, input.computerId);
  const workspaceRoot =
    computer.live_workspace_root ??
    computerWorkspacePath(input.tenantId, input.computerId);

  const accessPointId =
    computer.efs_access_point_id ??
    (await createAccessPoint({
      fileSystemId: config.efsFileSystemId,
      path: workspaceRoot,
      stage: config.stage,
      computerId: input.computerId,
      tenantId: input.tenantId,
    }));

  const taskDefinitionArn = await registerTaskDefinition({
    config,
    computerId: input.computerId,
    tenantId: input.tenantId,
    accessPointId,
    workspaceRoot,
  });

  const createServiceInput = buildCreateServiceInput({
    clusterName: config.clusterName,
    serviceName,
    taskDefinitionArn,
    subnetIds: config.subnetIds,
    taskSecurityGroupId: config.taskSecurityGroupId,
  });
  const serviceExists = await hasService(config.clusterName, serviceName);
  if (serviceExists) {
    await ecs.send(
      new UpdateServiceCommand({
        cluster: config.clusterName,
        service: serviceName,
        taskDefinition: taskDefinitionArn,
        desiredCount: 1,
      }),
    );
  } else {
    await ecs.send(new CreateServiceCommand(createServiceInput));
  }

  await db
    .update(computers)
    .set({
      efs_access_point_id: accessPointId,
      ecs_service_name: serviceName,
      live_workspace_root: workspaceRoot,
      desired_runtime_status: "running",
      runtime_status: "starting",
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    );
  await recordRuntimeEvent({
    tenantId: input.tenantId,
    computerId: input.computerId,
    eventType: "computer_runtime_provisioned",
    payload: {
      serviceName,
      accessPointId,
      taskDefinitionArn,
      workspaceRoot,
      image: config.image,
    },
  });

  return {
    computerId: input.computerId,
    serviceName,
    accessPointId,
    taskDefinitionArn,
    desiredRuntimeStatus: "running",
    runtimeStatus: "starting",
  };
}

export async function updateDesiredCount(
  input: { tenantId: string; computerId: string },
  desiredCount: number,
  desiredRuntimeStatus: "running" | "stopped",
) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  const serviceName = computer.ecs_service_name;
  if (!serviceName) {
    throw new ComputerRuntimeControlError(
      "Computer runtime is not provisioned",
      409,
    );
  }
  const config = runtimeConfig();
  await ecs.send(
    new UpdateServiceCommand({
      cluster: config.clusterName,
      service: serviceName,
      desiredCount,
    }),
  );
  await db
    .update(computers)
    .set({
      desired_runtime_status: desiredRuntimeStatus,
      runtime_status: desiredCount === 0 ? "stopped" : "starting",
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    );
  await recordRuntimeEvent({
    tenantId: input.tenantId,
    computerId: input.computerId,
    eventType:
      desiredCount === 0
        ? "computer_runtime_stop_requested"
        : "computer_runtime_start_requested",
    payload: { serviceName, desiredCount },
  });
  return {
    computerId: input.computerId,
    serviceName,
    desiredRuntimeStatus,
    desiredCount,
  };
}

export async function describeComputerRuntime(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  if (!computer.ecs_service_name) {
    return {
      computerId: input.computerId,
      provisioned: false,
      runtimeStatus: computer.runtime_status,
    };
  }
  const config = runtimeConfig();
  const result = await ecs.send(
    new DescribeServicesCommand({
      cluster: config.clusterName,
      services: [computer.ecs_service_name],
    }),
  );
  const service = result.services?.[0];
  const runtimeStatus = runtimeStatusFromService(service);
  await db
    .update(computers)
    .set({ runtime_status: runtimeStatus, updated_at: new Date() })
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    );
  return {
    computerId: input.computerId,
    provisioned: true,
    serviceName: computer.ecs_service_name,
    desiredCount: service?.desiredCount ?? null,
    runningCount: service?.runningCount ?? null,
    pendingCount: service?.pendingCount ?? null,
    status: service?.status ?? "UNKNOWN",
    runtimeStatus,
  };
}

async function createAccessPoint(input: {
  fileSystemId: string;
  path: string;
  stage: string;
  tenantId: string;
  computerId: string;
}) {
  const result = await efs.send(
    new CreateAccessPointCommand({
      FileSystemId: input.fileSystemId,
      PosixUser: { Uid: 1000, Gid: 1000 },
      RootDirectory: {
        Path: input.path,
        CreationInfo: {
          OwnerUid: 1000,
          OwnerGid: 1000,
          Permissions: "750",
        },
      },
      Tags: [
        {
          Key: "Name",
          Value: computerServiceName(input.stage, input.computerId),
        },
        { Key: "thinkwork:tenantId", Value: input.tenantId },
        { Key: "thinkwork:computerId", Value: input.computerId },
      ],
    }),
  );
  if (!result.AccessPointId) {
    throw new ComputerRuntimeControlError(
      "EFS access point was not returned",
      500,
    );
  }
  return result.AccessPointId;
}

async function registerTaskDefinition(input: {
  config: ReturnType<typeof runtimeConfig>;
  tenantId: string;
  computerId: string;
  accessPointId: string;
  workspaceRoot: string;
}) {
  const result = await ecs.send(
    new RegisterTaskDefinitionCommand(buildTaskDefinitionInput(input)),
  );
  const arn = result.taskDefinition?.taskDefinitionArn;
  if (!arn) {
    throw new ComputerRuntimeControlError(
      "Task definition ARN was not returned",
      500,
    );
  }
  return arn;
}

export function buildTaskDefinitionInput(input: {
  config: ReturnType<typeof runtimeConfig>;
  tenantId: string;
  computerId: string;
  accessPointId: string;
  workspaceRoot: string;
}): RegisterTaskDefinitionCommandInput {
  const family = computerServiceName(input.config.stage, input.computerId);
  return {
    family,
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",
    cpu: String(input.config.defaultCpu),
    memory: String(input.config.defaultMemory),
    executionRoleArn: input.config.executionRoleArn,
    taskRoleArn: input.config.taskRoleArn,
    runtimePlatform: {
      operatingSystemFamily: "LINUX",
      cpuArchitecture: "ARM64",
    },
    volumes: [
      {
        name: "workspace",
        efsVolumeConfiguration: {
          fileSystemId: input.config.efsFileSystemId,
          transitEncryption: "ENABLED",
          authorizationConfig: {
            accessPointId: input.accessPointId,
            iam: "DISABLED",
          },
        },
      },
    ],
    containerDefinitions: [
      {
        name: "computer-runtime",
        image: input.config.image,
        essential: true,
        mountPoints: [
          {
            sourceVolume: "workspace",
            containerPath: "/workspace",
            readOnly: false,
          },
        ],
        environment: [
          { name: "THINKWORK_API_URL", value: input.config.apiUrl },
          { name: "THINKWORK_API_SECRET", value: input.config.apiSecret },
          { name: "TENANT_ID", value: input.tenantId },
          { name: "COMPUTER_ID", value: input.computerId },
          { name: "WORKSPACE_ROOT", value: "/workspace" },
          { name: "RUNTIME_VERSION", value: input.config.runtimeVersion },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": input.config.logGroupName,
            "awslogs-region": input.config.region,
            "awslogs-stream-prefix": "computer",
          },
        },
      },
    ],
  };
}

export function buildCreateServiceInput(input: {
  clusterName: string;
  serviceName: string;
  taskDefinitionArn: string;
  subnetIds: string[];
  taskSecurityGroupId: string;
}): CreateServiceCommandInput {
  return {
    cluster: input.clusterName,
    serviceName: input.serviceName,
    taskDefinition: input.taskDefinitionArn,
    desiredCount: 1,
    launchType: "FARGATE",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: input.subnetIds,
        securityGroups: [input.taskSecurityGroupId],
        assignPublicIp: "DISABLED",
      },
    },
  };
}

function runtimeStatusFromService(
  service:
    | {
        status?: string;
        desiredCount?: number;
        runningCount?: number;
        pendingCount?: number;
      }
    | undefined,
) {
  if (!service || service.status === "INACTIVE") return "unknown";
  if ((service.desiredCount ?? 0) === 0) return "stopped";
  if ((service.runningCount ?? 0) > 0) return "running";
  if ((service.pendingCount ?? 0) > 0 || service.status === "ACTIVE") {
    return "starting";
  }
  return "unknown";
}

async function recordRuntimeEvent(input: {
  tenantId: string;
  computerId: string;
  eventType: string;
  payload: unknown;
}) {
  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    event_type: input.eventType,
    level: "info",
    payload: input.payload,
  });
}

async function hasService(cluster: string, serviceName: string) {
  const result = await ecs.send(
    new DescribeServicesCommand({ cluster, services: [serviceName] }),
  );
  const service = result.services?.[0];
  return !!service && service.status !== "INACTIVE";
}

async function loadComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select()
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) {
    throw new ComputerRuntimeControlError("Computer not found", 404);
  }
  return computer;
}

type RuntimeConfig = {
  stage: string;
  region: string;
  clusterName: string;
  efsFileSystemId: string;
  subnetIds: string[];
  taskSecurityGroupId: string;
  executionRoleArn: string;
  taskRoleArn: string;
  logGroupName: string;
  repositoryUrl: string;
  apiUrl: string;
  apiSecret: string;
  image: string;
  runtimeVersion: string;
  defaultCpu: number;
  defaultMemory: number;
};

function runtimeConfig(): RuntimeConfig {
  const repositoryUrl = requiredConfig(
    "repositoryUrl",
    process.env.COMPUTER_RUNTIME_REPOSITORY_URL,
  );
  const runtimeVersion =
    process.env.COMPUTER_RUNTIME_IMAGE_TAG || "phase2-skeleton";
  const required = {
    stage: process.env.STAGE || "dev",
    region: process.env.AWS_REGION || "us-east-1",
    clusterName: requiredConfig(
      "clusterName",
      process.env.COMPUTER_RUNTIME_CLUSTER_NAME,
    ),
    efsFileSystemId: requiredConfig(
      "efsFileSystemId",
      process.env.COMPUTER_RUNTIME_EFS_FILE_SYSTEM_ID,
    ),
    subnetIds: (process.env.COMPUTER_RUNTIME_SUBNET_IDS || "")
      .split(",")
      .filter(Boolean),
    taskSecurityGroupId: requiredConfig(
      "taskSecurityGroupId",
      process.env.COMPUTER_RUNTIME_TASK_SG_ID,
    ),
    executionRoleArn: requiredConfig(
      "executionRoleArn",
      process.env.COMPUTER_RUNTIME_EXECUTION_ROLE_ARN,
    ),
    taskRoleArn: requiredConfig(
      "taskRoleArn",
      process.env.COMPUTER_RUNTIME_TASK_ROLE_ARN,
    ),
    logGroupName: requiredConfig(
      "logGroupName",
      process.env.COMPUTER_RUNTIME_LOG_GROUP_NAME,
    ),
    repositoryUrl,
    apiUrl: requiredConfig("apiUrl", process.env.THINKWORK_API_URL),
    apiSecret: requiredConfig(
      "apiSecret",
      process.env.API_AUTH_SECRET || process.env.THINKWORK_API_SECRET,
    ),
  };
  if (required.subnetIds.length === 0) {
    throw new ComputerRuntimeControlError(
      "Missing Computer runtime config: subnetIds",
      500,
    );
  }
  return {
    ...required,
    image: `${repositoryUrl}:${runtimeVersion}`,
    runtimeVersion,
    defaultCpu: Number(process.env.COMPUTER_RUNTIME_DEFAULT_CPU || 256),
    defaultMemory: Number(process.env.COMPUTER_RUNTIME_DEFAULT_MEMORY || 512),
  };
}

function requiredConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new ComputerRuntimeControlError(
      `Missing Computer runtime config: ${name}`,
      500,
    );
  }
  return value;
}
