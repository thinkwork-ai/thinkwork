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

const PREFIX = "tenants/acme/agents/marco/workspace/";
// aws-sdk-client-mock's middleware-stack types and @aws-sdk/client-s3
// drift on minor SDK version bumps; the runtime behavior is correct
// regardless of the mismatch surfaced at the type level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s3Mock = mockClient(S3Client as any) as any;

function stubRemote(files: Record<string, string>) {
  s3Mock.on(ListObjectsV2Command).resolves({
    Contents: Object.keys(files).map((rel) => ({ Key: PREFIX + rel })),
    IsTruncated: false,
  } as never);
  for (const [rel, body] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(body);
    s3Mock.on(GetObjectCommand, { Key: PREFIX + rel }).resolves({
      Body: {
        transformToByteArray: async () => bytes,
      } as unknown as never,
    });
  }
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

    expect(result).toEqual({ synced: 3, deleted: 0, total: 3 });
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

    expect(result).toEqual({ synced: 0, deleted: 0, total: 0 });
  });
});
