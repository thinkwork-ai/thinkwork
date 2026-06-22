import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OkfWikiProviderError,
  createOkfWikiProvider,
} from "../src/runtime/providers/okf-wiki-provider.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "thinkwork-okf-"));
  await mkdir(path.join(root, "entities", "customer"), { recursive: true });
  await mkdir(path.join(root, "topics"), { recursive: true });
  await mkdir(path.join(root, ".thinkwork"), { recursive: true });
  await writeFile(
    path.join(root, "index.md"),
    [
      "# ThinkWork OKF Wiki Navigator",
      "",
      "- [Acme](entities/customer/acme.md)",
      "- [Revenue](/topics/revenue.md)",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, "log.md"), "# OKF Generation Log\n");
  await writeFile(
    path.join(root, "entities", "customer", "acme.md"),
    [
      "---",
      "type: ThinkWorkEntity",
      "title: Acme Corp",
      "x-thinkwork:",
      "  page_kind: entity",
      "---",
      "# Acme Corp",
      "",
      "Acme has a revenue renewal signal.",
      "This page links to [Revenue](../../topics/revenue.md).",
      "This external link [ignored](https://example.com) is not traversed.",
      "This escape link [ignored](../../../../outside.md) is not traversed.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "topics", "revenue.md"),
    [
      "---",
      "type: ThinkWorkTopic",
      "title: Revenue",
      "x-thinkwork:",
      "  page_kind: topic",
      "---",
      "# Revenue",
      "",
      "Revenue planning mentions Acme and renewals.",
      "Back to [Acme](../entities/customer/acme.md).",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, ".thinkwork", "manifest.json"),
    JSON.stringify({ bundleId: "okf-bundle:fixture" }),
  );
  await writeFile(path.join(root, "notes.txt"), "not markdown");
  await writeFile(path.join(root, ".secret.md"), "# hidden");
  await writeFile(
    path.join(root, "entities", "customer", "binary.md"),
    Buffer.from([0, 1, 2, 3]),
  );
  await writeFile(
    path.join(root, "entities", "customer", "invalid-utf8.md"),
    Buffer.from([0xff, 0xfe, 0xfd]),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createOkfWikiProvider", () => {
  it("lists allowed markdown entries and hides backend files", async () => {
    const provider = createOkfWikiProvider({ currentRoot: root });

    const result = await provider.list({ maxDepth: 3, maxResults: 20 });

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "entities",
      "entities/customer",
      "entities/customer/acme.md",
      "index.md",
      "log.md",
      "topics",
      "topics/revenue.md",
    ]);
    expect(
      result.entries.find((entry) => entry.path === "index.md"),
    ).toMatchObject({ kind: "file", title: "ThinkWork OKF Wiki Navigator" });
    expect(result.entries.map((entry) => entry.path)).not.toContain(
      ".thinkwork/manifest.json",
    );
    expect(result.entries.map((entry) => entry.path)).not.toContain(
      "notes.txt",
    );
    expect(result.entries.map((entry) => entry.path)).not.toContain(
      ".secret.md",
    );
  });

  it("searches markdown with path, line, title metadata and truncation", async () => {
    const provider = createOkfWikiProvider({ currentRoot: root });

    const result = await provider.search({
      query: "Acme",
      maxDepth: 3,
      maxResults: 1,
      maxBytes: 200,
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        path: "entities/customer/acme.md",
        line: expect.any(Number),
        title: "Acme Corp",
        pageKind: "entity",
        snippet: expect.stringContaining("Acme"),
      }),
    ]);
    expect(result.bounds).toMatchObject({
      maxResults: 1,
      maxBytes: 200,
      truncated: true,
    });
  });

  it("reads byte and line ranges with an untrusted source-data policy", async () => {
    const provider = createOkfWikiProvider({ currentRoot: root });

    await expect(
      provider.read({
        path: "entities/customer/acme.md",
        startLine: 7,
        endLine: 10,
        maxBytes: 200,
      }),
    ).resolves.toMatchObject({
      path: "entities/customer/acme.md",
      title: "Acme Corp",
      startLine: 7,
      endLine: 10,
      content: expect.stringContaining("Acme has a revenue"),
      redaction: {
        source: "okf_navigator",
        policy: "cite_or_summarize_only",
      },
    });

    const byteRange = await provider.read({
      path: "topics/revenue.md",
      offsetBytes: 0,
      maxBytes: 24,
    });
    expect(byteRange.bytesRead).toBeLessThanOrEqual(24);
    expect(byteRange.truncated).toBe(true);
  });

  it("clips byte-bounded reads and snippets on UTF-8 character boundaries", async () => {
    await writeFile(
      path.join(root, "topics", "unicode.md"),
      "# Unicode\n\nalpha 😀 needle beta\n",
    );
    const provider = createOkfWikiProvider({ currentRoot: root });

    await expect(
      provider.read({
        path: "topics/unicode.md",
        offsetBytes: 0,
        maxBytes: 11,
      }),
    ).resolves.toMatchObject({
      content: "# Unicode\n\n",
      bytesRead: 11,
      truncated: true,
    });

    const bodyPrefixBytes = Buffer.byteLength("# Unicode\n\nalpha ", "utf8");
    await expect(
      provider.read({
        path: "topics/unicode.md",
        offsetBytes: bodyPrefixBytes + 1,
        maxBytes: 10,
      }),
    ).resolves.toMatchObject({
      content: " needle be",
      offsetBytes: bodyPrefixBytes + 4,
      bytesRead: 10,
      truncated: true,
    });

    const search = await provider.search({
      query: "needle",
      path: "topics/unicode.md",
      maxBytes: 200,
    });
    expect(search.entries[0]?.snippet).toBe("alpha 😀 needle beta");

    const clipped = await provider.search({
      query: "needle",
      path: "topics/unicode.md",
      maxBytes: 9,
    });
    expect(clipped.entries[0]?.snippet).toBe("alpha ");
    expect(clipped.entries[0]?.snippet).not.toContain("\uFFFD");
  });

  it("allows the bundle manifest exception but rejects other hidden files", async () => {
    const provider = createOkfWikiProvider({ currentRoot: root });

    await expect(
      provider.read({ path: ".thinkwork/manifest.json" }),
    ).resolves.toMatchObject({
      path: ".thinkwork/manifest.json",
      content: expect.stringContaining("okf-bundle:fixture"),
    });
    await expect(provider.read({ path: ".secret.md" })).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("parses forward links and backlinks without following outside the bundle", async () => {
    const provider = createOkfWikiProvider({ currentRoot: root });

    await expect(
      provider.links({
        path: "entities/customer/acme.md",
        includeBacklinks: true,
        maxResults: 10,
      }),
    ).resolves.toMatchObject({
      path: "entities/customer/acme.md",
      links: [
        expect.objectContaining({
          path: "topics/revenue.md",
          label: "Revenue",
          title: "Revenue",
        }),
      ],
      backlinks: [
        expect.objectContaining({
          path: "index.md",
          title: "ThinkWork OKF Wiki Navigator",
        }),
        expect.objectContaining({
          path: "topics/revenue.md",
          title: "Revenue",
        }),
      ],
    });
  });

  it("searches and finds backlinks beyond the result limit scan window", async () => {
    await writeFile(path.join(root, "topics", "late-target.md"), "# Late\n");
    for (let index = 0; index < 40; index += 1) {
      await writeFile(
        path.join(root, "topics", `scan-${String(index).padStart(2, "0")}.md`),
        index === 39
          ? "# Deep\n\nThis file contains the deep-needle result and links to [Late](late-target.md).\n"
          : "# Empty\n\nNo matching text here.\n",
      );
    }
    const provider = createOkfWikiProvider({ currentRoot: root });

    await expect(
      provider.search({
        query: "deep-needle",
        path: "topics",
        maxDepth: 1,
        maxResults: 1,
      }),
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ path: "topics/scan-39.md" })],
    });

    await expect(
      provider.links({
        path: "topics/late-target.md",
        includeBacklinks: true,
        maxResults: 1,
      }),
    ).resolves.toMatchObject({
      backlinks: [expect.objectContaining({ path: "topics/scan-39.md" })],
    });
  });

  it("rejects unsafe paths across all path-taking operations", async () => {
    const outside = path.join(os.tmpdir(), `okf-outside-${Date.now()}.md`);
    await writeFile(outside, "# outside");
    await symlink(
      outside,
      path.join(root, "entities", "customer", "outside.md"),
    );
    await symlink(
      path.join(root, ".secret.md"),
      path.join(root, "entities", "customer", "visible-secret.md"),
    );
    await symlink(
      path.join(root, "notes.txt"),
      path.join(root, "entities", "customer", "visible-notes.md"),
    );
    await writeFile(path.join(root, ".thinkwork", "secret.md"), "# hidden");
    await symlink(
      path.join(root, ".thinkwork"),
      path.join(root, "visible-dir"),
    );
    const provider = createOkfWikiProvider({ currentRoot: root });

    const cases: Array<{
      label: string;
      run: () => Promise<unknown>;
      code?: string;
    }> = [
      {
        label: "list traversal",
        run: () => provider.list({ path: "../other-tenant/current" }),
        code: "invalid_path",
      },
      {
        label: "search traversal",
        run: () =>
          provider.search({
            query: "outside",
            path: "../other-tenant/current/index.md",
          }),
        code: "invalid_path",
      },
      {
        label: "read traversal",
        run: () => provider.read({ path: "../other-tenant/current/index.md" }),
        code: "invalid_path",
      },
      {
        label: "links traversal",
        run: () => provider.links({ path: "../other-tenant/current/index.md" }),
        code: "invalid_path",
      },
      {
        label: "list absolute",
        run: () => provider.list({ path: path.join(root, "index.md") }),
        code: "invalid_path",
      },
      {
        label: "search backslash",
        run: () =>
          provider.search({ query: "Acme", path: "topics\\revenue.md" }),
        code: "invalid_path",
      },
      {
        label: "read hidden",
        run: () => provider.read({ path: ".secret.md" }),
        code: "invalid_path",
      },
      {
        label: "links hidden",
        run: () => provider.links({ path: ".secret.md" }),
        code: "invalid_path",
      },
      {
        label: "list symlink escape",
        run: () => provider.list({ path: "entities/customer/outside.md" }),
        code: "invalid_path",
      },
      {
        label: "search symlink escape",
        run: () =>
          provider.search({
            query: "outside",
            path: "entities/customer/outside.md",
          }),
        code: "invalid_path",
      },
      {
        label: "read symlink escape",
        run: () => provider.read({ path: "entities/customer/outside.md" }),
        code: "invalid_path",
      },
      {
        label: "links symlink escape",
        run: () => provider.links({ path: "entities/customer/outside.md" }),
        code: "invalid_path",
      },
      {
        label: "read symlink to hidden",
        run: () =>
          provider.read({ path: "entities/customer/visible-secret.md" }),
        code: "invalid_path",
      },
      {
        label: "read symlink to unsupported",
        run: () =>
          provider.read({ path: "entities/customer/visible-notes.md" }),
        code: "invalid_path",
      },
      {
        label: "list symlink to hidden directory",
        run: () => provider.list({ path: "visible-dir" }),
        code: "invalid_path",
      },
      {
        label: "read file through symlinked hidden directory",
        run: () => provider.read({ path: "visible-dir/secret.md" }),
        code: "invalid_path",
      },
      {
        label: "list unsupported",
        run: () => provider.list({ path: "notes.txt" }),
        code: "unsupported_file",
      },
      {
        label: "search unsupported",
        run: () => provider.search({ query: "markdown", path: "notes.txt" }),
        code: "unsupported_file",
      },
      {
        label: "read unsupported",
        run: () => provider.read({ path: "notes.txt" }),
        code: "unsupported_file",
      },
      {
        label: "links unsupported",
        run: () => provider.links({ path: "notes.txt" }),
        code: "unsupported_file",
      },
      {
        label: "read binary markdown",
        run: () => provider.read({ path: "entities/customer/binary.md" }),
        code: "binary_file",
      },
      {
        label: "read invalid utf8 markdown",
        run: () => provider.read({ path: "entities/customer/invalid-utf8.md" }),
        code: "binary_file",
      },
    ];

    for (const { label, run, code } of cases) {
      const promise = run();
      await expect(promise, label).rejects.toBeInstanceOf(OkfWikiProviderError);
      if (code) await expect(promise, label).rejects.toMatchObject({ code });
      await expect(promise).rejects.not.toThrow(root);
    }
    await rm(outside, { force: true });
  });
});
