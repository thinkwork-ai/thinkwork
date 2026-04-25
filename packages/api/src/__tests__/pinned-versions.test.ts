/**
 * Tests for Unit 8 — initializePinnedVersions.
 *
 * Covers the content-addressable version store invariant: once a pin is
 * recorded, the composer's pinned-resolution path (Unit 4) can always
 * serve that exact content by hash, regardless of subsequent template
 * edits.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const s3Mock = mockClient(S3Client);

process.env.WORKSPACE_BUCKET = "test-bucket";

import {
  initializePinnedVersions,
  normalizeWorkspacePath,
  parseWorkspacePinPath,
} from "../lib/pinned-versions.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function body(content: string) {
  return {
    Body: {
      transformToString: async (_enc?: string) => content,
    } as unknown as never,
  };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

function notFoundHead() {
  const err = new Error("NotFound");
  err.name = "NotFound";
  (err as { $metadata?: { httpStatusCode?: number } }).$metadata = {
    httpStatusCode: 404,
  };
  return err;
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

const TENANT = "acme";
const TEMPLATE = "exec-assistant";

function templateKey(path: string) {
  return `tenants/${TENANT}/agents/_catalog/${TEMPLATE}/workspace/${path}`;
}

function defaultsKey(path: string) {
  return `tenants/${TENANT}/agents/_catalog/defaults/workspace/${path}`;
}

function versionKey(path: string, hex: string) {
  return `tenants/${TENANT}/agents/_catalog/${TEMPLATE}/workspace-versions/${path}@sha256:${hex}`;
}

beforeEach(() => {
  s3Mock.reset();
});

describe("workspace pinned path helpers", () => {
  it("accepts root and nested guardrail-class paths", () => {
    expect(parseWorkspacePinPath("GUARDRAILS.md")).toEqual({
      path: "GUARDRAILS.md",
      filename: "GUARDRAILS.md",
      folderPath: null,
    });
    expect(parseWorkspacePinPath("expenses/GUARDRAILS.md")).toEqual({
      path: "expenses/GUARDRAILS.md",
      filename: "GUARDRAILS.md",
      folderPath: "expenses",
    });
    expect(parseWorkspacePinPath("expenses/escalation/PLATFORM.md")).toEqual({
      path: "expenses/escalation/PLATFORM.md",
      filename: "PLATFORM.md",
      folderPath: "expenses/escalation",
    });
  });

  it("rejects non-pinned and unsafe workspace paths", () => {
    expect(parseWorkspacePinPath("expenses/CONTEXT.md")).toBeNull();
    expect(parseWorkspacePinPath("../GUARDRAILS.md")).toBeNull();
    expect(parseWorkspacePinPath("/GUARDRAILS.md")).toBeNull();
    expect(parseWorkspacePinPath(" /GUARDRAILS.md")).toBeNull();
    expect(parseWorkspacePinPath("")).toBeNull();
    expect(() => normalizeWorkspacePath("expenses\\GUARDRAILS.md")).toThrow(
      /Invalid workspace path/,
    );
  });
});

// ─── Pin resolution ──────────────────────────────────────────────────────────

describe("initializePinnedVersions", () => {
  it("resolves template override when one exists and records the template hash", async () => {
    const guardrails = "# Guardrails\nTemplate-specific rules";
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(guardrails));
    // PLATFORM and CAPABILITIES fall through to defaults.
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("PLATFORM.md") })
      .resolves(body("# Platform default"));
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("CAPABILITIES.md") })
      .resolves(body("# Capabilities default"));
    // Version store is empty — every HEAD 404s, every PUT succeeds.
    s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
    s3Mock.on(PutObjectCommand).resolves({});

    const pins = await initializePinnedVersions({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
    });

    expect(Object.keys(pins).sort()).toEqual([
      "CAPABILITIES.md",
      "GUARDRAILS.md",
      "PLATFORM.md",
    ]);
    expect(pins["GUARDRAILS.md"]).toBe(`sha256:${sha256(guardrails)}`);
    expect(pins["PLATFORM.md"]).toBe(`sha256:${sha256("# Platform default")}`);
  });

  it("falls back to defaults when template has no override for the pinned file", async () => {
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    const defaultGuardrails = "# Default guardrails";
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("GUARDRAILS.md") })
      .resolves(body(defaultGuardrails));
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("PLATFORM.md") })
      .resolves(body("# Platform"));
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("CAPABILITIES.md") })
      .resolves(body("# Capabilities"));
    s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
    s3Mock.on(PutObjectCommand).resolves({});

    const pins = await initializePinnedVersions({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
    });

    expect(pins["GUARDRAILS.md"]).toBe(`sha256:${sha256(defaultGuardrails)}`);
  });

  it("writes the content-addressable version store object so the composer can resolve by hash later", async () => {
    const content = "# G";
    const hex = sha256(content);
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(content));
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    s3Mock.on(HeadObjectCommand).rejects(notFoundHead());
    s3Mock.on(PutObjectCommand).resolves({});

    await initializePinnedVersions({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
    });

    const puts = s3Mock.commandCalls(PutObjectCommand);
    const keys = puts.map((c) => c.args[0].input.Key);
    expect(keys).toContain(versionKey("GUARDRAILS.md", hex));
    // Content matches the raw bytes, not substituted.
    const guardrailsPut = puts.find(
      (c) => c.args[0].input.Key === versionKey("GUARDRAILS.md", hex),
    );
    expect(guardrailsPut?.args[0].input.Body).toBe(content);
  });

  it("is idempotent — HEAD hit on the version key skips the PUT", async () => {
    const content = "# already stored";
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(content));
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("PLATFORM.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: defaultsKey("CAPABILITIES.md") })
      .rejects(noSuchKey());
    // Every HEAD succeeds — version already stored — so no PUTs happen.
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock
      .on(PutObjectCommand)
      .rejects(new Error("unexpected PUT on idempotent re-run"));

    const pins = await initializePinnedVersions({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
    });

    expect(pins["GUARDRAILS.md"]).toBeDefined();
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("omits a pin entry when neither template nor defaults has the file", async () => {
    s3Mock.on(GetObjectCommand).rejects(noSuchKey());
    s3Mock.on(HeadObjectCommand).rejects(notFoundHead());

    const pins = await initializePinnedVersions({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
    });
    expect(pins).toEqual({});
  });
});
