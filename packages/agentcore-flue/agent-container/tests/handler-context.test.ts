import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";

import {
  InvocationValidationError,
  logStructured,
  snapshotIdentity,
  snapshotRuntimeEnv,
  snapshotSecrets,
  validateMcpUrl,
} from "../src/handler-context.js";

describe("snapshotIdentity", () => {
  const baseValid = {
    tenant_id: "tenant-1",
    user_id: "user-1",
    assistant_id: "agent-1",
    thread_id: "thread-1",
  };

  it("returns the snapshot when all required fields are present", () => {
    const out = snapshotIdentity({
      ...baseValid,
      tenant_slug: "ts",
      instance_id: "agent-slug",
      trace_id: "tr",
    });
    expect(out).toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      tenantSlug: "ts",
      agentSlug: "agent-slug",
      traceId: "tr",
    });
  });

  it("trims whitespace on identity fields", () => {
    const out = snapshotIdentity({
      tenant_id: "  tenant-1 ",
      user_id: " user-1",
      assistant_id: "agent-1 ",
      thread_id: " thread-1 ",
    });
    expect(out.tenantId).toBe("tenant-1");
    expect(out.userId).toBe("user-1");
  });

  it.each([
    ["tenant_id"],
    ["user_id"],
    ["assistant_id"],
    ["thread_id"],
  ])("throws InvocationValidationError(400) when %s is missing", (field) => {
    const payload = { ...baseValid, [field]: "" };
    expect(() => snapshotIdentity(payload)).toThrow(InvocationValidationError);
    try {
      snapshotIdentity(payload);
    } catch (err) {
      expect((err as InvocationValidationError).statusCode).toBe(400);
    }
  });

  it("includes every missing field name in the error message", () => {
    expect(() =>
      snapshotIdentity({}),
    ).toThrow(/tenant_id.*user_id.*assistant_id.*thread_id/);
  });
});

describe("snapshotSecrets", () => {
  it("captures both URL + secret from the payload", () => {
    expect(
      snapshotSecrets({
        thinkwork_api_url: "https://api.example.com",
        thinkwork_api_secret: "test-secret-do-not-leak",
      }),
    ).toEqual({
      apiUrl: "https://api.example.com",
      apiAuthSecret: "test-secret-do-not-leak",
    });
  });

  it("returns empty strings when fields are missing (callback disabled)", () => {
    expect(snapshotSecrets({})).toEqual({ apiUrl: "", apiAuthSecret: "" });
  });

  it("trims whitespace", () => {
    expect(
      snapshotSecrets({
        thinkwork_api_url: "  https://api.example.com  ",
        thinkwork_api_secret: " s ",
      }),
    ).toEqual({
      apiUrl: "https://api.example.com",
      apiAuthSecret: "s",
    });
  });
});

describe("snapshotRuntimeEnv", () => {
  it("returns defaults when env is empty", () => {
    const env = snapshotRuntimeEnv({} as NodeJS.ProcessEnv);
    expect(env).toMatchObject({
      awsRegion: "us-east-1",
      memoryEngine: "managed",
      dbName: "thinkwork",
      workspaceDir: "/tmp/workspace",
      gitSha: "unknown",
    });
  });

  it("selects hindsight when MEMORY_ENGINE=hindsight (case-insensitive)", () => {
    expect(
      snapshotRuntimeEnv({ MEMORY_ENGINE: "Hindsight" } as NodeJS.ProcessEnv).memoryEngine,
    ).toBe("hindsight");
  });

  it("falls back to managed for any other MEMORY_ENGINE value", () => {
    expect(
      snapshotRuntimeEnv({ MEMORY_ENGINE: "weirdvalue" } as NodeJS.ProcessEnv).memoryEngine,
    ).toBe("managed");
  });

  it("prefers WORKSPACE_BUCKET over AGENTCORE_FILES_BUCKET", () => {
    expect(
      snapshotRuntimeEnv({
        WORKSPACE_BUCKET: "primary",
        AGENTCORE_FILES_BUCKET: "fallback",
      } as NodeJS.ProcessEnv).workspaceBucket,
    ).toBe("primary");
  });

  it("falls back to AGENTCORE_FILES_BUCKET when WORKSPACE_BUCKET is unset", () => {
    expect(
      snapshotRuntimeEnv({
        AGENTCORE_FILES_BUCKET: "fallback",
      } as NodeJS.ProcessEnv).workspaceBucket,
    ).toBe("fallback");
  });

  it("returns a fresh object each call (no module-load capture)", () => {
    const a = snapshotRuntimeEnv({ AWS_REGION: "us-west-2" } as NodeJS.ProcessEnv);
    const b = snapshotRuntimeEnv({ AWS_REGION: "eu-west-1" } as NodeJS.ProcessEnv);
    expect(a.awsRegion).toBe("us-west-2");
    expect(b.awsRegion).toBe("eu-west-1");
  });
});

describe("validateMcpUrl", () => {
  it("accepts a public HTTPS URL", () => {
    const result = validateMcpUrl("https://mcp.example.com/api");
    expect(result).toEqual({ ok: true, host: "mcp.example.com" });
  });

  it.each([
    ["http://example.com", "unsupported-scheme"],
    ["ws://example.com", "unsupported-scheme"],
    ["wss://example.com", "unsupported-scheme"],
    ["file:///etc/passwd", "unsupported-scheme"],
    ["gopher://evil.example.com", "unsupported-scheme"],
    ["javascript:alert(1)", "unsupported-scheme"],
    ["ftp://files.example.com", "unsupported-scheme"],
  ])("rejects %s as %s", (url, reason) => {
    const result = validateMcpUrl(url);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it.each([
    ["https://169.254.169.254/latest/meta-data/", "link-local-host"],
    ["https://169.254.0.1/", "link-local-host"],
    ["https://127.0.0.1/", "loopback-host"],
    ["https://127.10.0.1/", "loopback-host"],
    ["https://10.0.0.1/", "private-host"],
    ["https://10.255.255.255/", "private-host"],
    ["https://172.16.0.1/", "private-host"],
    ["https://172.31.255.1/", "private-host"],
    ["https://192.168.1.1/", "private-host"],
    ["https://0.0.0.0/", "private-host"],
  ])("rejects private IPv4 %s as %s", (url, reason) => {
    expect(validateMcpUrl(url).reason).toBe(reason);
  });

  it("does not reject 172.32.0.1 (outside RFC1918)", () => {
    expect(validateMcpUrl("https://172.32.0.1/").ok).toBe(true);
  });

  it("does not reject 192.169.0.1 (outside RFC1918)", () => {
    expect(validateMcpUrl("https://192.169.0.1/").ok).toBe(true);
  });

  it.each([
    ["https://[::1]/", "loopback-host"],
    ["https://[fe80::1]/", "link-local-host"],
    ["https://[fc00::1]/", "private-host"],
    ["https://[fd00::1]/", "private-host"],
    ["https://[::ffff:127.0.0.1]/", "loopback-host"],
    ["https://[::ffff:10.0.0.1]/", "private-host"],
  ])("rejects private IPv6 %s as %s", (url, reason) => {
    expect(validateMcpUrl(url).reason).toBe(reason);
  });

  it.each([
    ["https://localhost/", "loopback-host"],
    ["https://my.localhost/", "loopback-host"],
  ])("rejects %s as %s", (url, reason) => {
    expect(validateMcpUrl(url).reason).toBe(reason);
  });

  it("rejects invalid URL strings", () => {
    expect(validateMcpUrl("").reason).toBe("invalid-url");
    expect(validateMcpUrl("not a url").reason).toBe("invalid-url");
    expect(validateMcpUrl("https://").reason).toBe("invalid-url");
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — exercising runtime guard.
    expect(validateMcpUrl(null).reason).toBe("invalid-url");
    // @ts-expect-error — exercising runtime guard.
    expect(validateMcpUrl(undefined).reason).toBe("invalid-url");
  });
});

describe("logStructured", () => {
  function captureStdout(): {
    stream: Writable;
    lines: () => string[];
  } {
    const buffer: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        buffer.push(chunk.toString());
        cb();
      },
    });
    return { stream, lines: () => buffer };
  }

  it("writes one JSON line per call", () => {
    const out = captureStdout();
    logStructured(
      { level: "info", event: "test", tenantId: "t1" },
      out.stream,
    );
    const written = out.lines();
    expect(written).toHaveLength(1);
    expect(written[0]?.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written[0]!.trim());
    expect(parsed).toMatchObject({
      level: "info",
      event: "test",
      tenantId: "t1",
    });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts header objects with Authorization keys (case-insensitive)", () => {
    const out = captureStdout();
    logStructured(
      {
        level: "info",
        event: "headers_dump",
        headers: {
          Authorization: "Handle abc",
          AUTHORIZATION: "Bearer leaked",
          "x-api-key": "should-redact",
          "user-agent": "test/1.0",
        },
      },
      out.stream,
    );
    const parsed = JSON.parse(out.lines()[0]!.trim()) as {
      headers: Record<string, string>;
    };
    expect(parsed.headers.Authorization).toBe("[redacted]");
    expect(parsed.headers.AUTHORIZATION).toBe("[redacted]");
    expect(parsed.headers["x-api-key"]).toBe("[redacted]");
    expect(parsed.headers["user-agent"]).toBe("test/1.0");
  });

  it("redacts inline Authorization fragments inside string values", () => {
    const out = captureStdout();
    logStructured(
      {
        level: "warn",
        event: "msg",
        error: "fetch error: Authorization=Bearer xyz failed",
      },
      out.stream,
    );
    const parsed = JSON.parse(out.lines()[0]!.trim());
    expect(parsed.error).not.toContain("xyz");
    expect(parsed.error).toContain("[redacted]");
  });

  it("preserves arrays unchanged (does not coerce to header-like)", () => {
    const out = captureStdout();
    logStructured(
      { level: "info", event: "list", items: ["a", "b"] },
      out.stream,
    );
    const parsed = JSON.parse(out.lines()[0]!.trim());
    expect(parsed.items).toEqual(["a", "b"]);
  });
});
