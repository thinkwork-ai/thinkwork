import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPiSidecarDiagnostics,
  disabledPiSidecarState,
  redactDiagnosticValue,
} from "../../src/main/pi-sidecar-diagnostics";
import { redactPiDiagnosticLine } from "../../src/main/pi-sidecar-session";

describe("Pi sidecar diagnostics", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "thinkwork-pi-diagnostics-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("redacts credential, signed S3, OAuth, and user-message material", async () => {
    const diagnostics = createPiSidecarDiagnostics({
      userDataPath: root,
      appVersion: "0.1.0",
      stage: "dev",
      runtimeEnabled: true,
      hostType: "development",
      now: () => new Date("2026-05-28T12:00:00.000Z"),
      logger: silentLogger(),
    });

    await diagnostics.writeEvent("info", "turn prepared", {
      tenantId: "tenant-raw",
      agentId: "agent-raw",
      userMessage: "summarize this private customer record",
      authorization: "Bearer raw-token",
      secretAccessKey: "very-secret",
      signedUrl:
        "https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abcdef&X-Amz-Security-Token=session",
      oauthToken: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    });

    const log = await readFile(diagnostics.logPath, "utf8");
    expect(log).not.toContain("tenant-raw");
    expect(log).not.toContain("agent-raw");
    expect(log).not.toContain("summarize this private");
    expect(log).not.toContain("raw-token");
    expect(log).not.toContain("very-secret");
    expect(log).not.toContain("abcdef");
    expect(log).not.toContain("ghp_");
    expect(log).toContain("[redacted-message]");
    expect(log).toContain("[redacted]");
  });

  it("returns a diagnostics snapshot with hashed tenant and agent scope", () => {
    const diagnostics = createPiSidecarDiagnostics({
      userDataPath: root,
      appVersion: "0.1.0",
      stage: "canary",
      runtimeEnabled: true,
      hostType: "packaged",
      logger: silentLogger(),
    });

    const snapshot = diagnostics.snapshot({
      state: {
        status: "crashed",
        pid: null,
        version: "0.1.0",
        restartCount: 3,
        startedAt: null,
        updatedAt: "2026-05-28T12:00:00.000Z",
        lastExitCode: 1,
        lastError: { code: "EXIT", message: "Pi sidecar exited with code 1" },
      },
      tenantId: "tenant-raw",
      agentId: "agent-raw",
      delegationDecision: "visible",
    });

    expect(snapshot.runtime).toMatchObject({
      enabled: true,
      appVersion: "0.1.0",
      stage: "canary",
      hostType: "packaged",
    });
    expect(snapshot.sidecar).toMatchObject({
      status: "crashed",
      restartCount: 3,
      crashReason: "Pi sidecar exited with code 1",
    });
    expect(snapshot.scope.tenant).toMatch(/^sha256:[a-f0-9]{12}$/);
    expect(snapshot.scope.agent).toMatch(/^sha256:[a-f0-9]{12}$/);
    expect(JSON.stringify(snapshot)).not.toContain("tenant-raw");
    expect(JSON.stringify(snapshot)).not.toContain("agent-raw");
  });

  it("keeps local diagnostics logs bounded", async () => {
    const diagnostics = createPiSidecarDiagnostics({
      userDataPath: root,
      appVersion: "0.1.0",
      stage: "dev",
      runtimeEnabled: true,
      hostType: "development",
      maxBytes: 240,
      logger: silentLogger(),
    });

    await diagnostics.writeEvent("info", "first", {
      payload: "x".repeat(180),
    });
    await diagnostics.writeEvent("info", "second", {
      payload: "y".repeat(180),
    });

    const log = await readFile(diagnostics.logPath, "utf8");
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(240);
    expect(log).toContain("second");
  });

  it("exposes disabled state without starting a sidecar", () => {
    expect(
      disabledPiSidecarState(new Date("2026-05-28T12:00:00.000Z")),
    ).toMatchObject({
      status: "unavailable",
      lastError: {
        code: "DISABLED",
      },
    });
  });

  it("redacts plain diagnostic strings and structured records", () => {
    expect(
      redactPiDiagnosticLine(
        '{"message":"this is a private user message","authorization":"Bearer abc","url":"https://s3.test/key?X-Amz-Signature=secret"}',
      ),
    ).not.toContain("private user message");
    expect(
      redactDiagnosticValue({
        content: "private content",
        refreshToken: "refresh-token",
      }),
    ).toEqual({
      content: "[redacted-message]",
      refreshToken: "[redacted]",
    });
  });
});

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
