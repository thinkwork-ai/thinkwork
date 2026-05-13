/**
 * Tests for the workspace-files-efs sidecar Lambda — the VPC-attached
 * handler that reads any Computer's workspace files directly off the
 * shared EFS, bypassing the computer_tasks queue.
 *
 * The handler is a pure function over the local filesystem rooted at
 * WORKSPACE_EFS_ROOT, so the tests point that env var at a tmpdir and
 * scaffold files under <root>/<tenantId>/computers/<computerId>/...
 * The path-safety contract (no absolute paths, no traversal escape) is
 * the load-bearing security property — verify it before adding feature
 * coverage.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const COMPUTER_ID = "22222222-2222-4222-8222-222222222222";

let EFS_ROOT: string;

beforeAll(() => {
  EFS_ROOT = mkdtempSync(path.join(tmpdir(), "workspace-efs-test-"));
  process.env.WORKSPACE_EFS_ROOT = EFS_ROOT;
});

afterAll(() => {
  rmSync(EFS_ROOT, { recursive: true, force: true });
});

async function setupComputerFiles(files: Record<string, string>) {
  const computerRoot = path.join(
    EFS_ROOT,
    TENANT_ID,
    "computers",
    COMPUTER_ID,
  );
  rmSync(computerRoot, { recursive: true, force: true });
  await mkdir(computerRoot, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(computerRoot, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

async function loadHandler() {
  // Re-import so a per-test WORKSPACE_EFS_ROOT change is honored. Vitest
  // caches ESM imports, but the handler reads the env var at module-init,
  // so we use vi.resetModules() in beforeEach to make the import fresh.
  const mod = await import("../handlers/workspace-files-efs.js");
  return mod.handler;
}

describe("workspace-files-efs handler", () => {
  beforeEach(async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
  });

  it("lists files under the per-Computer root, omitting operational artifacts", async () => {
    await setupComputerFiles({
      "USER.md": "Eric\n",
      "memory/notes.md": "hello\n",
      "manifest.json": "{}",
      "_defaults_version": "1",
      "skills/web-search/SKILL.md": "builtin tool",
    });
    const handler = await loadHandler();
    const res = await handler({
      action: "list",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !("files" in res)) throw new Error("expected list response");
    const paths = res.files.map((f) => f.path).sort();
    expect(paths).toEqual(["USER.md", "memory/notes.md"]);
    for (const f of res.files) {
      expect(f.source).toBe("computer");
      expect(f.overridden).toBe(false);
      expect(f.content).toBeUndefined();
    }
  });

  it("includes file content when includeContent is true", async () => {
    await setupComputerFiles({
      "USER.md": "Name: Eric\n",
      "memory/contacts.md": "Eve\n",
    });
    const handler = await loadHandler();
    const res = await handler({
      action: "list",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      includeContent: true,
    });
    if (!res.ok || !("files" in res)) throw new Error("expected list response");
    const byPath = Object.fromEntries(res.files.map((f) => [f.path, f]));
    expect(byPath["USER.md"]?.content).toBe("Name: Eric\n");
    expect(byPath["memory/contacts.md"]?.content).toBe("Eve\n");
  });

  it("returns empty list when the Computer root does not yet exist", async () => {
    const handler = await loadHandler();
    const res = await handler({
      action: "list",
      tenantId: "99999999-9999-4999-8999-999999999999",
      computerId: "99999999-9999-4999-8999-999999999998",
    });
    expect(res).toEqual({ ok: true, files: [] });
  });

  it("get returns content for an existing file", async () => {
    await setupComputerFiles({ "USER.md": "Name: Eric\n" });
    const handler = await loadHandler();
    const res = await handler({
      action: "get",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      path: "USER.md",
    });
    expect(res).toMatchObject({
      ok: true,
      content: "Name: Eric\n",
      source: "computer",
    });
  });

  it("get returns null content for a missing file", async () => {
    await setupComputerFiles({ "USER.md": "x" });
    const handler = await loadHandler();
    const res = await handler({
      action: "get",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      path: "does-not-exist.md",
    });
    expect(res).toMatchObject({ ok: true, content: null, source: "computer" });
  });

  it("rejects non-UUID tenantId/computerId", async () => {
    const handler = await loadHandler();
    const res = await handler({
      action: "list",
      tenantId: "not-a-uuid",
      computerId: COMPUTER_ID,
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects path traversal attempts", async () => {
    await setupComputerFiles({ "USER.md": "x" });
    const handler = await loadHandler();
    const res = await handler({
      action: "get",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      path: "../../../etc/passwd",
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects absolute paths", async () => {
    await setupComputerFiles({ "USER.md": "x" });
    const handler = await loadHandler();
    const res = await handler({
      action: "get",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      path: "/etc/passwd",
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects unknown actions", async () => {
    const handler = await loadHandler();
    const res = await handler({
      // @ts-expect-error — testing the runtime guard, not the type
      action: "delete",
      tenantId: TENANT_ID,
      computerId: COMPUTER_ID,
      path: "USER.md",
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});
