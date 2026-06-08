import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeploymentSession,
  readDeploymentSession,
  requestDeploymentSessionTeardown,
  startDeploymentSession,
} from "./deployment-sessions";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example.com/");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deployment session client", () => {
  it("creates sessions through the public REST API", async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        session: { id: "session-1" },
        clientToken: "token-1",
      }),
    );

    const result = await createDeploymentSession({
      customerName: "TEI",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: ["us-east-1a", "us-east-1b"],
      adminName: "Eric Odom",
      adminEmail: "eric@example.com",
      source: "local_dev",
    });

    expect(result.clientToken).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/deployment-sessions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("tei-e2e"),
      }),
    );
  });

  it("uses the resume token for reads, start, and teardown", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ session: { id: "session-1" } }))
      .mockResolvedValueOnce(
        response({
          session: { id: "session-1", status: "deploying" },
        }),
      )
      .mockResolvedValueOnce(
        response({
          session: { id: "session-1", status: "teardown_requested" },
        }),
      );

    await readDeploymentSession({
      sessionId: "session-1",
      clientToken: "token-1",
    });
    await startDeploymentSession({
      sessionId: "session-1",
      clientToken: "token-1",
    });
    await requestDeploymentSessionTeardown({
      sessionId: "session-1",
      clientToken: "token-1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.com/api/deployment-sessions/session-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-thinkwork-deployment-token": "token-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example.com/api/deployment-sessions/session-1/start",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-thinkwork-deployment-token": "token-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.example.com/api/deployment-sessions/session-1/teardown",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-thinkwork-deployment-token": "token-1",
        }),
      }),
    );
  });
});

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}
