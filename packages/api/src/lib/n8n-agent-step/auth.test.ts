import { describe, expect, it } from "vitest";
import { extractBearerToken, extractBridgeCredential } from "./auth.js";

describe("n8n agent-step bridge auth helpers", () => {
  it("extracts bearer tokens", () => {
    expect(extractBearerToken("Bearer bridge-token")).toBe("bridge-token");
    expect(extractBearerToken("bearer rotated-token ")).toBe("rotated-token");
    expect(extractBearerToken("Basic nope")).toBeNull();
  });

  it("extracts the dedicated bridge credential from secret JSON", () => {
    expect(
      extractBridgeCredential(
        JSON.stringify({
          THINKWORK_N8N_AGENT_STEP_BRIDGE_TOKEN: "bridge-token",
          N8N_MCP_SERVICE_CREDENTIAL: "do-not-use",
        }),
      ),
    ).toBe("bridge-token");
    expect(extractBridgeCredential("plain-token")).toBe("plain-token");
    expect(
      extractBridgeCredential(
        JSON.stringify({ N8N_MCP_SERVICE_CREDENTIAL: "wrong-token" }),
      ),
    ).toBeNull();
  });
});
