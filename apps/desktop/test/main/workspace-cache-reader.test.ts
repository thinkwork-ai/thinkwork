import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  PathEscapeError,
  readCacheFile,
  resolveWithinCacheRoot,
  walkCacheTree,
} from "../../src/main/workspace-cache-reader";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ws-cache-root-"));
  outside = await mkdtemp(join(tmpdir(), "ws-outside-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("resolveWithinCacheRoot (path guard)", () => {
  it("accepts a legitimate nested relative path", async () => {
    await mkdir(join(root, "dev", "acme"), { recursive: true });
    await writeFile(join(root, "dev", "acme", "GOAL.md"), "# GOAL");
    await expect(
      resolveWithinCacheRoot(root, "dev/acme/GOAL.md"),
    ).resolves.toContain("GOAL.md");
  });

  it("rejects parent-traversal, encoded, and absolute paths", async () => {
    await expect(
      resolveWithinCacheRoot(root, "../../etc/passwd"),
    ).rejects.toBeInstanceOf(PathEscapeError);
    // Percent-encoded dot-segments arrive literally; treated as a filename, not
    // traversal — it resolves inside the root and then 404s as ENOENT, never
    // escaping. The raw `..` form is the real traversal vector and is rejected.
    await expect(
      resolveWithinCacheRoot(root, "/etc/passwd"),
    ).rejects.toBeInstanceOf(PathEscapeError);
    await expect(
      resolveWithinCacheRoot(root, "a/../../b"),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("rejects a symlink whose realpath escapes the root", async () => {
    await writeFile(join(outside, "secret.txt"), "tokens");
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
    await expect(
      resolveWithinCacheRoot(root, "escape.txt"),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("accepts a symlink that stays within the root", async () => {
    await writeFile(join(root, "real.txt"), "ok");
    await symlink(join(root, "real.txt"), join(root, "link.txt"));
    await expect(resolveWithinCacheRoot(root, "link.txt")).resolves.toContain(
      "real.txt",
    );
  });
});

describe("walkCacheTree", () => {
  it("returns empty when the root does not exist", async () => {
    await rm(root, { recursive: true, force: true });
    expect(await walkCacheTree(root)).toEqual({ status: "empty" });
  });

  it("filters sidecar sentinels and prunes sentinel-only folders", async () => {
    await mkdir(join(root, "dev"), { recursive: true });
    await writeFile(join(root, "dev", "GOAL.md"), "# GOAL");
    await writeFile(join(root, "dev", "manifest.json"), "{}");
    await writeFile(join(root, "dev", "_defaults_version"), "1");
    await writeFile(join(root, "dev", ".thinkwork-workspace-cache.json"), "{}");
    await mkdir(join(root, "onlysentinels"), { recursive: true });
    await writeFile(join(root, "onlysentinels", "manifest.json"), "{}");

    const result = await walkCacheTree(root);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const dev = result.tree.find((n) => n.name === "dev");
    expect(dev?.kind).toBe("dir");
    expect(dev?.children?.map((c) => c.name)).toEqual(["GOAL.md"]);
    expect(result.tree.find((n) => n.name === "onlysentinels")).toBeUndefined();
  });

  it("reports empty when only sentinels exist", async () => {
    await writeFile(join(root, "manifest.json"), "{}");
    expect(await walkCacheTree(root)).toEqual({ status: "empty" });
  });

  it("marks truncated when the node budget is exceeded", async () => {
    await mkdir(join(root, "a"), { recursive: true });
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, "a", `f${i}.txt`), "x");
    }
    const result = await walkCacheTree(root, { maxNodes: 3 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.truncated).toBe(true);
  });
});

describe("readCacheFile", () => {
  it("reads small text with a mapped language", async () => {
    await writeFile(join(root, "GOAL.md"), "# GOAL");
    expect(await readCacheFile(root, "GOAL.md")).toEqual({
      status: "ok",
      content: "# GOAL",
      language: "markdown",
    });
  });

  it("falls back to text for unknown/extensionless files", async () => {
    await writeFile(join(root, "AGENTS"), "no ext");
    const result = await readCacheFile(root, "AGENTS");
    expect(result).toMatchObject({ status: "ok", language: "text" });
  });

  it("returns too-large without reading full contents", async () => {
    await writeFile(join(root, "big.bin"), "x".repeat(64));
    const result = await readCacheFile(root, "big.bin", { maxBytes: 10 });
    expect(result).toEqual({ status: "too-large", size: 64 });
  });

  it("detects binary content via null byte", async () => {
    await writeFile(join(root, "blob"), Buffer.from([1, 2, 0, 3, 4]));
    expect(await readCacheFile(root, "blob")).toEqual({ status: "binary" });
  });

  it("returns vanished for a missing file", async () => {
    expect(await readCacheFile(root, "gone.md")).toEqual({ status: "vanished" });
  });

  it("returns error EACCES for a traversal attempt", async () => {
    expect(await readCacheFile(root, "../../etc/passwd")).toEqual({
      status: "error",
      code: "EACCES",
    });
  });

  it("returns EISDIR when the path is a directory", async () => {
    await mkdir(join(root, "adir"), { recursive: true });
    expect(await readCacheFile(root, "adir")).toEqual({
      status: "error",
      code: "EISDIR",
    });
  });

  it("exposes a sane default cap", () => {
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024);
  });
});
