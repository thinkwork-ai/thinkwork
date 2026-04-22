import { describe, it, expect } from "vitest";
import {
  buildInvocationEvent,
  interpretResponse,
} from "./sandbox-provisioning.js";

describe("buildInvocationEvent", () => {
  it("emits the API Gateway v2 envelope agentcore-admin expects", () => {
    const event = buildInvocationEvent(
      "11111111-2222-3333-4444-555555555555",
      "secret-token",
    ) as any;
    expect(event.requestContext.http.method).toBe("POST");
    expect(event.requestContext.http.path).toBe("/provision-tenant-sandbox");
    expect(event.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(event.body).tenant_id).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
});

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

describe("interpretResponse", () => {
  it("returns the parsed body on 200", () => {
    const res = interpretResponse({
      Payload: encode({
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          partial: false,
          tenant_id: "t-1",
          role_arn: "arn:aws:iam::1:role/r",
          interpreters: { public_id: "ci-a", internal_id: "ci-b" },
        }),
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.interpreters.public_id).toBe("ci-a");
  });

  it("returns partial=true on 202", () => {
    const res = interpretResponse({
      Payload: encode({
        statusCode: 202,
        body: JSON.stringify({
          ok: false,
          partial: true,
          tenant_id: "t-1",
          role_arn: "arn:aws:iam::1:role/r",
          interpreters: { public_id: "ci-a", internal_id: null },
        }),
      }),
    });
    expect(res.partial).toBe(true);
    expect(res.interpreters.internal_id).toBeNull();
  });

  it("throws on a 4xx statusCode with the server-side error surfaced", () => {
    expect(() =>
      interpretResponse({
        Payload: encode({
          statusCode: 400,
          body: JSON.stringify({ error: "valid tenant_id UUID required" }),
        }),
      }),
    ).toThrow(/valid tenant_id UUID required/);
  });

  it("throws on a Lambda FunctionError", () => {
    expect(() =>
      interpretResponse({
        FunctionError: "Unhandled",
        Payload: encode({ errorMessage: "boom" }),
      }),
    ).toThrow(/boom/);
  });
});
