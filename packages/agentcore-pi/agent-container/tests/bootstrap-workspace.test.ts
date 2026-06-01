/**
 * Pi-runtime bootstrap-workspace tests — same contract as the Strands
 * Python helper (test_bootstrap_workspace.py): list, download, delete
 * orphans. No overlay, no manifest fingerprint, no ETag-conditional
 * GETs.
 */

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { bootstrapWorkspace } from "../src/runtime/bootstrap-workspace.js";

const PREFIX = "tenants/acme/agents/marco/";
const SOURCE_PREFIX = "tenants/acme/agents/marco/";
const THREAD_PREFIX = "tenants/acme/threads/customer-kickoff/";
// aws-sdk-client-mock's middleware-stack types and @aws-sdk/client-s3
// drift on minor SDK version bumps; the runtime behavior is correct
// regardless of the mismatch surfaced at the type level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s3Mock = mockClient(S3Client as any) as any;

function stubRemote(files: Record<string, string>, prefix = PREFIX) {
  s3Mock.on(ListObjectsV2Command).resolves({
    Contents: Object.keys(files).map((rel) => ({ Key: prefix + rel })),
    IsTruncated: false,
  } as never);
  for (const [rel, body] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(body);
    s3Mock.on(GetObjectCommand, { Key: prefix + rel }).resolves({
      Body: {
        transformToByteArray: async () => bytes,
      } as unknown as never,
    });
  }
}

function stubObject(key: string, body: string) {
  const bytes = new TextEncoder().encode(body);
  s3Mock.on(GetObjectCommand, { Key: key }).resolves({
    Body: {
      transformToByteArray: async () => bytes,
    } as unknown as never,
  });
}

let tmp: string;

beforeEach(async () => {
  s3Mock.reset();
  tmp = await mkdtemp(path.join(tmpdir(), "pi-bootstrap-"));
});

afterEach(async () => {
  // Best-effort cleanup; vitest tmpdirs are isolated.
});

async function readFiles(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile()) {
        const rel = path.relative(dir, abs).split(path.sep).join("/");
        out[rel] = (await readFile(abs)).toString("utf-8");
      }
    }
  }
  await walk(dir);
  return out;
}

describe("bootstrapWorkspace (Pi runtime)", () => {
  const s3 = new S3Client({ region: "us-east-1" });

  it("downloads every remote file into local_dir", async () => {
    stubRemote({
      "AGENTS.md": "# Marco of Acme",
      "IDENTITY.md": "I am Marco.",
      "memory/decisions.md": "yo",
    });

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test");

    expect(result).toEqual({
      synced: 3,
      deleted: 0,
      total: 3,
      prefix: PREFIX,
    });
    const files = await readFiles(tmp);
    expect(files["AGENTS.md"]).toBe("# Marco of Acme");
    expect(files["IDENTITY.md"]).toBe("I am Marco.");
    expect(files["memory/decisions.md"]).toBe("yo");
  });

  it("skips manifest.json and _defaults_version operational artifacts", async () => {
    stubRemote({
      "AGENTS.md": "real",
      "manifest.json": "should-skip",
      _defaults_version: "should-skip",
    });

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test");

    expect(result.synced).toBe(1);
    expect(result.total).toBe(1);
    const files = await readFiles(tmp);
    expect(Object.keys(files)).toEqual(["AGENTS.md"]);
  });

  it("deletes locals that are absent in s3", async () => {
    await mkdir(path.join(tmp, "memory"), { recursive: true });
    await writeFile(path.join(tmp, "AGENTS.md"), "stale local");
    await writeFile(path.join(tmp, "stale.md"), "delete me");
    await writeFile(path.join(tmp, "memory", "old.md"), "delete me too");

    stubRemote({ "AGENTS.md": "fresh remote" });

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test");

    expect(result.synced).toBe(1);
    expect(result.deleted).toBe(2);
    const files = await readFiles(tmp);
    expect(files).toEqual({ "AGENTS.md": "fresh remote" });
  });

  it("overwrites local files with remote bytes", async () => {
    await writeFile(path.join(tmp, "AGENTS.md"), "old local");
    stubRemote({ "AGENTS.md": "new remote" });

    await bootstrapWorkspace("acme", "marco", tmp, s3, "test");

    const files = await readFiles(tmp);
    expect(files["AGENTS.md"]).toBe("new remote");
  });

  it("creates local_dir if missing", async () => {
    const target = path.join(tmp, "nope", "ws");
    stubRemote({ "AGENTS.md": "x" });

    const result = await bootstrapWorkspace(
      "acme",
      "marco",
      target,
      s3,
      "test",
    );

    expect(result.synced).toBe(1);
    const files = await readFiles(target);
    expect(files["AGENTS.md"]).toBe("x");
  });

  it("empty remote returns zero synced", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] } as never);

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test");

    expect(result).toEqual({ synced: 0, deleted: 0, total: 0, prefix: PREFIX });
  });

  it("syncs the canonical agent source workspace when provided", async () => {
    stubRemote(
      {
        "AGENTS.md": "# Marco",
        "skills/research/SKILL.md": "# Research",
      },
      SOURCE_PREFIX,
    );

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
      workspacePrefix: SOURCE_PREFIX,
    });

    expect(result).toEqual({
      synced: 2,
      deleted: 0,
      total: 2,
      prefix: SOURCE_PREFIX,
    });
    const files = await readFiles(tmp);
    expect(files["AGENTS.md"]).toBe("# Marco");
    expect(files["skills/research/SKILL.md"]).toBe("# Research");
  });

  it("syncs the per-thread runtime workspace when provided", async () => {
    stubRemote(
      {
        "GOAL.md": "# Goal",
        "PROGRESS.md": "# Progress",
        "DECISIONS.md": "# Decisions",
      },
      THREAD_PREFIX,
    );

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
      workspacePrefix: THREAD_PREFIX,
    });

    expect(result).toEqual({
      synced: 3,
      deleted: 0,
      total: 3,
      prefix: THREAD_PREFIX,
    });
    const files = await readFiles(tmp);
    expect(files["GOAL.md"]).toBe("# Goal");
    expect(files["PROGRESS.md"]).toBe("# Progress");
    expect(files["DECISIONS.md"]).toBe("# Decisions");
  });

  it("unwraps tuple-rendered workspaces into the runtime sandbox layout", async () => {
    stubRemote(
      {
        "Agent/workspace/AGENTS.md": "# Agent",
        "Agent/skills/research/SKILL.md": "# Skill",
        "Agent/workspace-archives/old/AGENTS.md": "# Old",
        "User/USER.md": "# User",
        "Spaces/default/source/SPACE.md": "# Space",
        "Spaces/default/source/docs/customer.md": "# Customer",
      },
      THREAD_PREFIX,
    );

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
      workspacePrefix: THREAD_PREFIX,
    });

    expect(result).toMatchObject({ synced: 5, total: 5 });
    const files = await readFiles(tmp);
    expect(files).toMatchObject({
      "AGENTS.md": "# Agent",
      "skills/research/SKILL.md": "# Skill",
      "USER.md": "# User",
      "Space/SPACE.md": "# Space",
      "Space/docs/customer.md": "# Customer",
    });
    expect(files["Agent/workspace/AGENTS.md"]).toBeUndefined();
    expect(files["User/USER.md"]).toBeUndefined();
    expect(files["Spaces/default/source/SPACE.md"]).toBeUndefined();
    expect(files["workspace-archives/old/AGENTS.md"]).toBeUndefined();
  });

  it("hydrates tuple-rendered workspaces from the rendered manifest", async () => {
    const manifest = {
      version: 1,
      renderedPrefix: THREAD_PREFIX,
      generatedAt: "2026-05-31T12:00:00.000Z",
      sources: [
        { owner: "agent", prefix: SOURCE_PREFIX },
        { owner: "space", prefix: "tenants/acme/spaces/default/" },
        { owner: "user", prefix: "tenants/acme/users/eric/" },
      ],
      files: [
        {
          path: "Agent/workspace/AGENTS.md",
          owner: "agent",
          sourceKey: `${SOURCE_PREFIX}workspace/AGENTS.md`,
          sourcePrefix: SOURCE_PREFIX,
          sourcePath: "AGENTS.md",
          readOnly: false,
        },
        {
          path: "Agent/skills/research/SKILL.md",
          owner: "agent",
          sourceKey: `${SOURCE_PREFIX}skills/research/SKILL.md`,
          sourcePrefix: SOURCE_PREFIX,
          sourcePath: "skills/research/SKILL.md",
          readOnly: false,
        },
        {
          path: "Agent/workspace-archives/old/AGENTS.md",
          owner: "agent",
          sourceKey: `${SOURCE_PREFIX}workspace-archives/old/AGENTS.md`,
          sourcePrefix: SOURCE_PREFIX,
          sourcePath: "workspace-archives/old/AGENTS.md",
          readOnly: false,
        },
        {
          path: "User/USER.md",
          owner: "user",
          sourceKey: "tenants/acme/users/eric/USER.md",
          sourcePrefix: "tenants/acme/users/eric/",
          sourcePath: "USER.md",
          readOnly: false,
        },
        {
          path: "Spaces/default/source/CONTEXT.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/default/source/CONTEXT.md",
          sourcePrefix: "tenants/acme/spaces/default/",
          sourcePath: "CONTEXT.md",
          readOnly: false,
        },
        {
          path: "Spaces/default/source/plans/plan.md",
          owner: "space",
          sourceKey: "tenants/acme/spaces/default/source/plans/plan.md",
          sourcePrefix: "tenants/acme/spaces/default/",
          sourcePath: "plans/plan.md",
          readOnly: false,
        },
      ],
      statusMounts: [
        {
          path: "Spaces/default/GOAL.md",
          owner: "system",
          source: "database",
          provider: "thread-goals",
          readOnly: true,
          available: true,
          sourceKey: `${THREAD_PREFIX}GOAL.md`,
        },
      ],
    };

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: `${THREAD_PREFIX}.hydrate_manifest.json` },
        { Key: `${THREAD_PREFIX}.rendered_at` },
      ],
      IsTruncated: false,
    } as never);
    stubObject(
      `${THREAD_PREFIX}.hydrate_manifest.json`,
      JSON.stringify(manifest),
    );
    stubObject(`${SOURCE_PREFIX}workspace/AGENTS.md`, "# Agent");
    stubObject(`${SOURCE_PREFIX}skills/research/SKILL.md`, "# Skill");
    stubObject(`${SOURCE_PREFIX}workspace-archives/old/AGENTS.md`, "# Old");
    stubObject("tenants/acme/users/eric/USER.md", "# User");
    stubObject("tenants/acme/spaces/default/source/CONTEXT.md", "# Space");
    stubObject("tenants/acme/spaces/default/source/plans/plan.md", "# Plan");
    stubObject(`${THREAD_PREFIX}GOAL.md`, "# Goal");

    const result = await bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
      workspacePrefix: THREAD_PREFIX,
    });

    expect(result).toMatchObject({ synced: 6, total: 6 });
    const files = await readFiles(tmp);
    expect(files).toMatchObject({
      "AGENTS.md": "# Agent",
      "skills/research/SKILL.md": "# Skill",
      "USER.md": "# User",
      "Space/CONTEXT.md": "# Space",
      "Space/plans/plan.md": "# Plan",
      "Space/GOAL.md": "# Goal",
    });
    expect(files["Agent/workspace/AGENTS.md"]).toBeUndefined();
    expect(files["Spaces/default/source/CONTEXT.md"]).toBeUndefined();
    expect(files["workspace-archives/old/AGENTS.md"]).toBeUndefined();
  });

  it("rejects workspace prefixes outside the tenant/agent scope", async () => {
    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/other/agents/marco/",
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/acme/agents/other-agent/",
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/other/threads/customer-kickoff/",
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/acme/threads/",
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");

    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/acme/rendered/marco/sales/eric/",
      }),
    ).rejects.toThrow("outside the expected tenant/agent scope");
  });

  it("rejects unsafe workspace prefixes", async () => {
    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "/tenants/acme/agents/marco/",
      }),
    ).rejects.toThrow("relative S3 prefix");

    await expect(
      bootstrapWorkspace("acme", "marco", tmp, s3, "test", {
        workspacePrefix: "tenants/acme/agents/marco/../eric/",
      }),
    ).rejects.toThrow("unsafe path segment");
  });
});
