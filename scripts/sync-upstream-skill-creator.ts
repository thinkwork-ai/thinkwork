import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UPSTREAM_SKILL_CREATOR_SOURCE,
  computeSkillCreatorContentDigest,
  type UpstreamSkillCreatorFile,
  type UpstreamSkillCreatorProvenance,
} from "../packages/api/src/lib/skill-creator/upstream-sources.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const targetDir = path.join(
  repoRoot,
  "packages/workspace-defaults/files/skills/skill-creator",
);
const workspaceDefaultsIndex = path.join(
  repoRoot,
  "packages/workspace-defaults/src/index.ts",
);
const constantsBegin = "// BEGIN GENERATED SKILL_CREATOR_DEFAULTS";
const constantsEnd = "// END GENERATED SKILL_CREATOR_DEFAULTS";
const contentBegin = "  // BEGIN GENERATED SKILL_CREATOR_CONTENT";
const contentEnd = "  // END GENERATED SKILL_CREATOR_CONTENT";
const targetDefaultsVersion = 25;

interface GitHubCommit {
  sha: string;
}

interface GitHubTree {
  tree: Array<{
    path: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
  }>;
}

async function main() {
  const commit = await fetchJson<GitHubCommit>(
    `https://api.github.com/repos/${UPSTREAM_SKILL_CREATOR_SOURCE.owner}/${UPSTREAM_SKILL_CREATOR_SOURCE.repo}/commits/${UPSTREAM_SKILL_CREATOR_SOURCE.branch}`,
  );
  const tree = await fetchJson<GitHubTree>(
    `https://api.github.com/repos/${UPSTREAM_SKILL_CREATOR_SOURCE.owner}/${UPSTREAM_SKILL_CREATOR_SOURCE.repo}/git/trees/${commit.sha}?recursive=1`,
  );
  const prefix = `${UPSTREAM_SKILL_CREATOR_SOURCE.sourcePath}/`;
  const entries = tree.tree
    .filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (entries.length === 0) {
    throw new Error(`No upstream files found below ${prefix}`);
  }

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const files: UpstreamSkillCreatorFile[] = [];
  const fileContents = new Map<string, string>();
  for (const entry of entries) {
    const relativePath = entry.path.slice(prefix.length);
    assertSafeRelativePath(relativePath);
    const content = await fetchText(
      `https://raw.githubusercontent.com/${UPSTREAM_SKILL_CREATOR_SOURCE.owner}/${UPSTREAM_SKILL_CREATOR_SOURCE.repo}/${commit.sha}/${entry.path}`,
    );
    const dest = path.join(targetDir, relativePath);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content);
    const sha256 = sha256Hex(content);
    files.push({
      path: relativePath,
      sha: entry.sha,
      size: entry.size ?? Buffer.byteLength(content),
      sha256,
    });
    fileContents.set(relativePath, content);
  }

  const provenance: UpstreamSkillCreatorProvenance = {
    source: UPSTREAM_SKILL_CREATOR_SOURCE,
    commit: commit.sha,
    fetchedAt: new Date().toISOString(),
    contentSha256: computeSkillCreatorContentDigest(files),
    files,
  };
  await writeFile(
    path.join(targetDir, "UPSTREAM.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  fileContents.set("UPSTREAM.json", `${JSON.stringify(provenance, null, 2)}\n`);

  await updateWorkspaceDefaultsIndex(fileContents);

  console.log(
    `Synced ${files.length} upstream skill-creator files from ${commit.sha}`,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function assertSafeRelativePath(relativePath: string) {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").includes("..")
  ) {
    throw new Error(`Unsafe upstream path: ${relativePath}`);
  }
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function constNameForSkillCreatorPath(relativePath: string): string {
  const slug = relativePath
    .replace(/\.[^.]+$/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toUpperCase();
  return `SKILL_CREATOR_${slug || "ROOT"}`;
}

async function updateWorkspaceDefaultsIndex(fileContents: Map<string, string>) {
  let source = await readFile(workspaceDefaultsIndex, "utf8");
  const skillCreatorPaths = [...fileContents.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => `skills/skill-creator/${relativePath}`);

  const constantsBlock = [
    constantsBegin,
    ...[...fileContents.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([relativePath, content]) =>
        [
          "",
          "/**",
          ` * Upstream mirror of \`packages/workspace-defaults/files/skills/skill-creator/${relativePath}\`.`,
          " * Generated by `scripts/sync-upstream-skill-creator.ts`.",
          " */",
          `const ${constNameForSkillCreatorPath(relativePath)} = ${JSON.stringify(content)};`,
        ].join("\n"),
      ),
    constantsEnd,
    "",
  ].join("\n");

  source = replaceOrInsertBlock({
    source,
    begin: constantsBegin,
    end: constantsEnd,
    block: constantsBlock,
    insertBefore:
      "/**\n * Mirror of `packages/workspace-defaults/files/TOOLS.md`.",
  });

  source = source.replace(
    /export const DEFAULTS_VERSION = \d+;/u,
    `export const DEFAULTS_VERSION = ${targetDefaultsVersion};`,
  );
  source = source.replace(
    /Canonical \d+-file set\./u,
    "Canonical default workspace file set.",
  );

  source = replaceCanonicalFileNames(source, skillCreatorPaths);
  source = replaceContentEntries(source, skillCreatorPaths);

  await writeFile(workspaceDefaultsIndex, source);
}

function replaceOrInsertBlock(input: {
  source: string;
  begin: string;
  end: string;
  block: string;
  insertBefore: string;
}): string {
  const start = input.source.indexOf(input.begin);
  if (start >= 0) {
    const finish = input.source.indexOf(input.end, start);
    if (finish < 0)
      throw new Error(`Found ${input.begin} without ${input.end}`);
    return `${input.source.slice(0, start)}${input.block}${input.source.slice(
      finish + input.end.length,
    )}`;
  }

  const insertion = input.source.indexOf(input.insertBefore);
  if (insertion < 0) {
    throw new Error(`Could not find insertion point: ${input.insertBefore}`);
  }
  return `${input.source.slice(0, insertion)}${input.block}${input.source.slice(
    insertion,
  )}`;
}

function replaceCanonicalFileNames(
  source: string,
  skillCreatorPaths: string[],
): string {
  const match = source.match(
    /export const CANONICAL_FILE_NAMES = \[\n(?<body>[\s\S]*?)\] as const;/u,
  );
  if (!match?.groups?.body) throw new Error("CANONICAL_FILE_NAMES not found");
  const existing = [...match.groups.body.matchAll(/"([^"]+)"/gu)]
    .map((m) => m[1])
    .filter((name) => !name.startsWith("skills/skill-creator/"));
  const insertionIndex =
    existing.indexOf("skills/artifact-builder/references/crm-dashboard.md") + 1;
  const names =
    insertionIndex > 0
      ? [
          ...existing.slice(0, insertionIndex),
          ...skillCreatorPaths,
          ...existing.slice(insertionIndex),
        ]
      : [...existing, ...skillCreatorPaths];
  const next = `export const CANONICAL_FILE_NAMES = [\n${names
    .map((name) => `  ${JSON.stringify(name)},`)
    .join("\n")}\n] as const;`;
  return source.replace(match[0], next);
}

function replaceContentEntries(source: string, skillCreatorPaths: string[]) {
  const contentEntries = [
    contentBegin,
    ...skillCreatorPaths.map((name) => {
      const relativePath = name.replace("skills/skill-creator/", "");
      return `  ${JSON.stringify(name)}: ${constNameForSkillCreatorPath(relativePath)},`;
    }),
    contentEnd,
  ].join("\n");

  const start = source.indexOf(contentBegin);
  if (start >= 0) {
    const finish = source.indexOf(contentEnd, start);
    if (finish < 0)
      throw new Error(`Found ${contentBegin} without ${contentEnd}`);
    return `${source.slice(0, start)}${contentEntries}${source.slice(
      finish + contentEnd.length,
    )}`;
  }

  const insertion = source.indexOf(
    "\n};\n\n/**\n * Return the canonical default",
  );
  if (insertion < 0) throw new Error("Could not find CONTENT insertion point");
  return `${source.slice(0, insertion)}\n${contentEntries}${source.slice(
    insertion,
  )}`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
