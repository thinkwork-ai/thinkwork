import { describe, expect, it } from "vitest";
import { BINDING_REDACTION_PLACEHOLDER, redactBindingArgs } from "./redact.js";

const R = BINDING_REDACTION_PLACEHOLDER;

describe("redactBindingArgs", () => {
  it("masks values under secret-shaped keys", () => {
    const out = redactBindingArgs({
      apiKey: "abc",
      access_token: "xyz",
      Authorization: "Bearer z",
      password: "hunter2",
      client_secret: "s",
      region: "us-east-1",
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe(R);
    expect(out.access_token).toBe(R);
    expect(out.Authorization).toBe(R);
    expect(out.password).toBe(R);
    expect(out.client_secret).toBe(R);
    // Non-secret key with a short plain value passes through.
    expect(out.region).toBe("us-east-1");
  });

  it("masks PII-shaped string values under innocuous keys", () => {
    const out = redactBindingArgs({
      contact: "jane.doe@example.com",
      ssn: "123-45-6789",
      account: "1234567890",
    }) as Record<string, unknown>;
    expect(out.contact).toBe(R);
    expect(out.ssn).toBe(R);
    expect(out.account).toBe(R);
  });

  it("masks 9+ digit numeric ids and long strings", () => {
    const out = redactBindingArgs({
      bigId: 123456789,
      small: 42,
      blob: "x".repeat(300),
      short: "ok",
    }) as Record<string, unknown>;
    expect(out.bigId).toBe(R);
    expect(out.small).toBe(42);
    expect(out.blob).toBe(R);
    expect(out.short).toBe("ok");
  });

  it("passes short plain primitives verbatim", () => {
    const out = redactBindingArgs({
      status: "open",
      limit: 25,
      enabled: true,
      empty: null,
    });
    expect(out).toEqual({
      status: "open",
      limit: 25,
      enabled: true,
      empty: null,
    });
  });

  it("recurses into nested objects and arrays, preserving structure", () => {
    const out = redactBindingArgs({
      filter: { token: "secret", name: "widgets" },
      ids: [1, 2, 3],
      emails: ["a@b.com", "plain"],
    }) as Record<string, any>;
    expect(out.filter.token).toBe(R);
    expect(out.filter.name).toBe("widgets");
    expect(out.ids).toEqual([1, 2, 3]);
    expect(out.emails).toEqual([R, "plain"]);
  });

  it("inspects a bare primitive input as a single leaf", () => {
    expect(redactBindingArgs("jane@example.com")).toBe(R);
    expect(redactBindingArgs("ok")).toBe("ok");
  });
});
