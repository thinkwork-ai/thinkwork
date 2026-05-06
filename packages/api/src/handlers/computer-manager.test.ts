import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => {
  class ComputerRuntimeControlError extends Error {
    constructor(
      message: string,
      readonly statusCode = 400,
    ) {
      super(message);
      this.name = "ComputerRuntimeControlError";
    }
  }
  return {
    controlComputerRuntime: vi.fn(),
    ComputerRuntimeControlError,
  };
});

vi.mock("../lib/auth.js", () => ({
  extractBearerToken: (event: APIGatewayProxyEventV2): string | null => {
    const header = event.headers?.authorization ?? null;
    return header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : null;
  },
  validateApiSecret: (token: string): boolean => token === "service-secret",
}));

vi.mock("../lib/computers/runtime-control.js", () => ({
  controlComputerRuntime: mocks.controlComputerRuntime,
  ComputerRuntimeControlError: mocks.ComputerRuntimeControlError,
}));

import { handler } from "./computer-manager.js";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const COMPUTER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function event(
  body: Record<string, unknown>,
  options: { method?: string; auth?: string | null } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/computers/manager",
    headers:
      options.auth === null
        ? {}
        : { authorization: options.auth ?? "Bearer service-secret" },
    body: JSON.stringify(body),
    requestContext: { http: { method: options.method ?? "POST" } },
  } as unknown as APIGatewayProxyEventV2;
}

describe("computer-manager handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.controlComputerRuntime.mockResolvedValue({
      computerId: COMPUTER_ID,
      serviceName: "thinkwork-dev-computer-aa",
    });
  });

  it("requires service auth", async () => {
    const response = await handler(
      event(
        { action: "provision", tenantId: TENANT_ID, computerId: COMPUTER_ID },
        { auth: null },
      ),
    );

    expect(response.statusCode).toBe(401);
    expect(mocks.controlComputerRuntime).not.toHaveBeenCalled();
  });

  it("validates action and UUID inputs before controlling AWS resources", async () => {
    const badAction = await handler(
      event({
        action: "explode",
        tenantId: TENANT_ID,
        computerId: COMPUTER_ID,
      }),
    );
    expect(badAction.statusCode).toBe(400);

    const badTenant = await handler(
      event({
        action: "provision",
        tenantId: "tenant",
        computerId: COMPUTER_ID,
      }),
    );
    expect(badTenant.statusCode).toBe(400);
    expect(mocks.controlComputerRuntime).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const response = await handler({
      rawPath: "/api/computers/manager",
      headers: { authorization: "Bearer service-secret" },
      body: "{not-json",
      requestContext: { http: { method: "POST" } },
    } as unknown as APIGatewayProxyEventV2);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      error: "Request body must be JSON",
    });
    expect(mocks.controlComputerRuntime).not.toHaveBeenCalled();
  });

  it("routes provision/start/stop/restart/status actions to runtime control", async () => {
    for (const action of ["provision", "start", "stop", "restart", "status"]) {
      const response = await handler(
        event({ action, tenantId: TENANT_ID, computerId: COMPUTER_ID }),
      );
      expect(response.statusCode).toBe(200);
    }

    expect(mocks.controlComputerRuntime).toHaveBeenCalledTimes(5);
    expect(mocks.controlComputerRuntime).toHaveBeenCalledWith({
      action: "provision",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
    });
  });

  it("maps runtime-control domain errors to their status code", async () => {
    mocks.controlComputerRuntime.mockRejectedValueOnce(
      new mocks.ComputerRuntimeControlError(
        "Computer runtime is not provisioned",
        409,
      ),
    );

    const response = await handler(
      event({ action: "start", tenantId: TENANT_ID, computerId: COMPUTER_ID }),
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      error: "Computer runtime is not provisioned",
    });
  });
});
