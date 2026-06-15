import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  DescribeServicesCommandMock,
  DescribeTargetGroupsCommandMock,
  DescribeTargetHealthCommandMock,
  ECSClientMock,
  ElasticLoadBalancingV2ClientMock,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerTenantId,
  ecsSendMock,
  elbv2SendMock,
} = vi.hoisted(() => ({
  DescribeServicesCommandMock: vi.fn(function (
    this: { input: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
  DescribeTargetGroupsCommandMock: vi.fn(function (
    this: { input: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
  DescribeTargetHealthCommandMock: vi.fn(function (
    this: { input: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
  ECSClientMock: vi.fn(),
  ElasticLoadBalancingV2ClientMock: vi.fn(),
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  ecsSendMock: vi.fn(),
  elbv2SendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  DescribeServicesCommand: DescribeServicesCommandMock,
  ECSClient: ECSClientMock,
}));

vi.mock("@aws-sdk/client-elastic-load-balancing-v2", () => ({
  DescribeTargetGroupsCommand: DescribeTargetGroupsCommandMock,
  DescribeTargetHealthCommand: DescribeTargetHealthCommandMock,
  ElasticLoadBalancingV2Client: ElasticLoadBalancingV2ClientMock,
}));

vi.mock("./authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

let mod: typeof import("./knowledgeGraphHealthCheck.query.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  ecsSendMock.mockReset();
  elbv2SendMock.mockReset();
  ECSClientMock.mockReset();
  ECSClientMock.mockImplementation(() => ({ send: ecsSendMock }));
  ElasticLoadBalancingV2ClientMock.mockReset();
  ElasticLoadBalancingV2ClientMock.mockImplementation(() => ({
    send: elbv2SendMock,
  }));
  DescribeServicesCommandMock.mockClear();
  DescribeTargetGroupsCommandMock.mockClear();
  DescribeTargetHealthCommandMock.mockClear();
  mod = await import("./knowledgeGraphHealthCheck.query.js");
});

const cognito = { auth: { authType: "cognito" } } as any;

describe("knowledgeGraphHealthCheck", () => {
  it("refuses a member before probing the private Cognee endpoint", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    await expect(
      mod.knowledgeGraphHealthCheck(null, {}, cognito),
    ).rejects.toThrow(/admin/i);

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      cognito,
      "tenant-1",
      "knowledge_graph:health_check",
    );
    expect(ecsSendMock).not.toHaveBeenCalled();
    expect(elbv2SendMock).not.toHaveBeenCalled();
  });

  it("returns an unhealthy result without network access when Cognee is off", async () => {
    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: null,
      latencyMs: 0,
      endpoint: null,
      message: "Cognee is not provisioned for this stage.",
    });
    expect(ecsSendMock).not.toHaveBeenCalled();
    expect(elbv2SendMock).not.toHaveBeenCalled();
  });

  it("checks ECS service and ALB target health when Cognee is enabled", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          status: "ACTIVE",
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED" }],
        },
      ],
    });
    elbv2SendMock
      .mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupArn: "target-group-arn" }],
      })
      .mockResolvedValueOnce({
        TargetHealthDescriptions: [{ TargetHealth: { State: "healthy" } }],
      });

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(DescribeServicesCommandMock).toHaveBeenCalledWith({
      cluster: "thinkwork-dev-brain-cluster",
      services: ["thinkwork-dev-cognee"],
    });
    expect(DescribeTargetGroupsCommandMock).toHaveBeenCalledWith({
      Names: ["tw-dev-cognee"],
    });
    expect(DescribeTargetHealthCommandMock).toHaveBeenCalledWith({
      TargetGroupArn: "target-group-arn",
    });
    expect(result).toMatchObject({
      healthy: true,
      statusCode: 200,
      endpoint: "http://cognee.internal",
      message: "Cognee ECS service is steady and the ALB target is healthy.",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it("uses an explicit COGNEE_CLUSTER_ARN override for the ECS probe", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv(
      "COGNEE_CLUSTER_ARN",
      "arn:aws:ecs:us-west-2:210987654321:cluster/compat-cluster",
    );
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          status: "ACTIVE",
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED" }],
        },
      ],
    });
    elbv2SendMock
      .mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupArn: "target-group-arn" }],
      })
      .mockResolvedValueOnce({
        TargetHealthDescriptions: [{ TargetHealth: { State: "healthy" } }],
      });

    await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(DescribeServicesCommandMock).toHaveBeenCalledWith({
      cluster: "arn:aws:ecs:us-west-2:210987654321:cluster/compat-cluster",
      services: ["thinkwork-dev-cognee"],
    });
  });

  it("returns an unhealthy result when the ECS service is not steady", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          status: "ACTIVE",
          desiredCount: 1,
          runningCount: 0,
          pendingCount: 1,
          deployments: [{ status: "PRIMARY", rolloutState: "IN_PROGRESS" }],
        },
      ],
    });

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: 503,
      endpoint: "http://cognee.internal",
      message: "Cognee ECS service thinkwork-dev-cognee is not steady.",
    });
    expect(elbv2SendMock).not.toHaveBeenCalled();
  });

  it("returns an unhealthy result when the ALB target is unhealthy", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    ecsSendMock.mockResolvedValueOnce({
      services: [
        {
          status: "ACTIVE",
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED" }],
        },
      ],
    });
    elbv2SendMock
      .mockResolvedValueOnce({
        TargetGroups: [{ TargetGroupArn: "target-group-arn" }],
      })
      .mockResolvedValueOnce({
        TargetHealthDescriptions: [{ TargetHealth: { State: "unhealthy" } }],
      });

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: 503,
      endpoint: "http://cognee.internal",
      message: "Cognee ALB target group tw-dev-cognee has 0/1 healthy targets.",
    });
  });

  it("returns an unhealthy result when the AWS health check fails", async () => {
    vi.stubEnv("COGNEE", "dogfood|http://cognee.internal");
    ecsSendMock.mockRejectedValueOnce(new Error("AccessDenied"));

    const result = await mod.knowledgeGraphHealthCheck(null, {}, cognito);

    expect(result).toMatchObject({
      healthy: false,
      statusCode: null,
      endpoint: "http://cognee.internal",
      message: "Cognee AWS health check could not be completed.",
    });
  });
});
