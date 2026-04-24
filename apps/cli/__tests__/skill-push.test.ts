/**
 * Tests for `thinkwork skill push` — plan §U14.
 *
 * Split across two concerns:
 *   - `buildPluginZip` covers the local-side validation + zip roundtrip.
 *   - `pushPluginZip` covers the HTTP flow (presign → PUT → upload) with
 *     mocked fetch so we can assert on request shapes + result unions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";

import { buildPluginZip, PluginZipError } from "../src/lib/plugin-zip.js";
import { pushPluginZip } from "../src/lib/plugin-push.js";

// ---------------------------------------------------------------------------
// buildPluginZip
// ---------------------------------------------------------------------------

describe("buildPluginZip", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "plugin-zip-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function write(relPath: string, body: string) {
    const abs = join(workDir, relPath);
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, body);
  }

  it("happy path: reads plugin.json + zips skills folder", async () => {
    write(
      "plugin.json",
      JSON.stringify({ name: "my-plugin", version: "0.1.0" }),
    );
    write("skills/greet/SKILL.md", "---\nname: greet\n---\nsay hello");

    const result = await buildPluginZip(workDir);
    expect(result.plugin.name).toBe("my-plugin");
    expect(result.plugin.version).toBe("0.1.0");
    expect(result.fileCount).toBe(2);

    // Reopen the zip and confirm entry paths — jszip auto-creates dir
    // entries, so filter to actual files before asserting.
    const zip = await JSZip.loadAsync(result.buffer);
    const files = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(files).toEqual(["plugin.json", "skills/greet/SKILL.md"]);
  });

  it("rejects missing plugin.json with structured error", async () => {
    write("skills/x/SKILL.md", "body");
    await expect(buildPluginZip(workDir)).rejects.toBeInstanceOf(
      PluginZipError,
    );
    try {
      await buildPluginZip(workDir);
    } catch (err) {
      expect((err as PluginZipError).kind).toBe("missing-plugin-json");
    }
  });

  it("rejects invalid plugin.json JSON", async () => {
    write("plugin.json", "{ not json");
    await expect(buildPluginZip(workDir)).rejects.toMatchObject({
      kind: "invalid-plugin-json",
    });
  });

  it("rejects plugin.json without a name field", async () => {
    write("plugin.json", JSON.stringify({ version: "1.0.0" }));
    await expect(buildPluginZip(workDir)).rejects.toMatchObject({
      kind: "invalid-plugin-json",
    });
  });

  it("rejects symlinks inside the plugin dir", async () => {
    write("plugin.json", JSON.stringify({ name: "p" }));
    write("real.md", "real");
    try {
      symlinkSync(join(workDir, "real.md"), join(workDir, "link.md"));
    } catch {
      // Some filesystems (covered by the test container) don't allow
      // symlinks — skip this assertion rather than fail the whole run.
      return;
    }
    await expect(buildPluginZip(workDir)).rejects.toMatchObject({
      kind: "unsafe-entry",
    });
  });

  it("skips .git / .DS_Store / node_modules junk", async () => {
    write("plugin.json", JSON.stringify({ name: "p" }));
    write(".git/HEAD", "ref: refs/heads/main");
    write(".DS_Store", "junk");
    write("node_modules/foo/index.js", "// junk");
    write("skills/a/SKILL.md", "body");

    const result = await buildPluginZip(workDir);
    expect(result.fileCount).toBe(2);
    const zip = await JSZip.loadAsync(result.buffer);
    const files = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(files).toEqual(["plugin.json", "skills/a/SKILL.md"]);
  });

  it("rejects non-existent directory", async () => {
    await expect(
      buildPluginZip(join(workDir, "does-not-exist")),
    ).rejects.toMatchObject({ kind: "missing-directory" });
  });
});

// ---------------------------------------------------------------------------
// pushPluginZip
// ---------------------------------------------------------------------------

describe("pushPluginZip", () => {
  const ZIP = Buffer.from("pretend-zip");
  const base = {
    apiUrl: "https://api.example",
    headers: { Authorization: "jwt-abc" },
    zipBuffer: ZIP,
    fileName: "my-plugin.zip",
  };

  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("happy path: presign → PUT → install 'installed' response", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: unknown;
      body: unknown;
    }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: RequestInit = {}) => {
      const href = String(url);
      calls.push({
        url: href,
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
      });
      if (href.endsWith("/api/plugins/presign")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            uploadUrl: "https://s3.example/upload",
            s3Key: "tenants/t/_plugin-uploads/u1/bundle.zip",
          }),
        } as Response;
      }
      if (href === "https://s3.example/upload") {
        return { ok: true, status: 200 } as Response;
      }
      if (href.endsWith("/api/plugins/upload")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            uploadId: "u1",
            status: "installed",
            plugin: {
              name: "my-plugin",
              skills: [{ slug: "greet" }],
              mcpServers: [],
            },
            warnings: [],
          }),
        } as Response;
      }
      throw new Error(`unexpected URL ${href}`);
    }) as unknown as typeof fetch;

    const result = await pushPluginZip(base);
    expect(result).toMatchObject({ status: "installed", uploadId: "u1" });
    if (result.status !== "installed") throw new Error("narrow");
    expect(result.plugin.name).toBe("my-plugin");
    expect(result.plugin.skills).toHaveLength(1);

    // Presign + upload carry the Cognito auth header; S3 PUT doesn't.
    expect(calls[0]!.method).toBe("POST");
    expect((calls[0]!.headers as Record<string, string>).Authorization).toBe(
      "jwt-abc",
    );
    expect(calls[1]!.method).toBe("PUT");
    expect(
      (calls[1]!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(calls[2]!.method).toBe("POST");
  });

  it("surfaces 400 validation errors as 'validation-failed'", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/api/plugins/presign")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ uploadUrl: "https://s3", s3Key: "k" }),
        } as Response;
      }
      if (href === "https://s3") {
        return { ok: true, status: 200 } as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          valid: false,
          errors: ["plugin.json: missing name"],
          warnings: ["skills/x: empty"],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await pushPluginZip(base);
    expect(result.status).toBe("validation-failed");
    if (result.status !== "validation-failed") throw new Error("narrow");
    expect(result.errors).toContain("plugin.json: missing name");
  });

  it("surfaces saga failures as 'failed' with phase + message", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/api/plugins/presign")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ uploadUrl: "https://s3", s3Key: "k" }),
        } as Response;
      }
      if (href === "https://s3") {
        return { ok: true, status: 200 } as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({
          uploadId: "u9",
          status: "failed",
          phase: "copy",
          errorMessage: "S3 copy timed out",
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await pushPluginZip(base);
    expect(result).toMatchObject({
      status: "failed",
      uploadId: "u9",
      phase: "copy",
      errorMessage: "S3 copy timed out",
    });
  });

  it("throws when presign returns non-ok (auth failure / network)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    })) as unknown as typeof fetch;

    await expect(pushPluginZip(base)).rejects.toThrow(/presign failed/i);
  });

  it("throws when S3 PUT fails", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const href = String(url);
      if (href.endsWith("/api/plugins/presign")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ uploadUrl: "https://s3", s3Key: "k" }),
        } as Response;
      }
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;

    await expect(pushPluginZip(base)).rejects.toThrow(/S3 PUT failed/);
  });
});
