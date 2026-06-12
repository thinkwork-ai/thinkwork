import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const contractDocs = [
  "docs/runbooks/workspace-architecture-verification.md",
  "docs/runbooks/spaces-runtime-renderer-rollout.md",
  "docs/src/content/docs/concepts/agents/workspace-architecture/index.mdx",
  "docs/src/content/docs/concepts/agents/workspace-architecture/workspace-tree.mdx",
  "docs/src/content/docs/concepts/agents/workspace-architecture/ownership-model.mdx",
  "docs/src/content/docs/concepts/agents/workspace-architecture/turn-lifecycle.mdx",
  "docs/src/content/docs/concepts/spaces/workspace-context.mdx",
  "docs/src/content/docs/guides/spaces/goals-and-files.mdx",
];

function readDoc(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

test("workspace contract docs describe the v1 runtime shape", () => {
  const docs = Object.fromEntries(
    contractDocs.map((path) => [path, readDoc(path)]),
  );
  const combined = Object.entries(docs)
    .map(([path, content]) => `\n--- ${path} ---\n${content}`)
    .join("\n");

  const staleRuntimeExamples = [
    /active Space (?:appears as|is mounted as) singular `Space\/`/i,
    /User source is merged into (?:that|the) root/i,
    /`USER\.md` should be at root/i,
    /`Space\/GOAL\.md`/i,
    /`Space\/PROGRESS\.md`/i,
    /^├── USER\.md$/m,
    /^└── Space\/$/m,
    /^├── Space\/$/m,
    /- `\/workspace\/Spaces`/,
    /- `\/workspace\/User`/,
  ];

  for (const pattern of staleRuntimeExamples) {
    assert.doesNotMatch(combined, pattern);
  }

  assert.match(
    docs[
      "docs/src/content/docs/concepts/agents/workspace-architecture/index.mdx"
    ],
    /Spaces\/<active-space>/,
  );
  assert.match(
    docs[
      "docs/src/content/docs/concepts/agents/workspace-architecture/index.mdx"
    ],
    /Workspace Routing[\s\S]+User\/[\s\S]+USER\.md[\s\S]+Thread\/[\s\S]+PROGRESS\.md/,
  );
  assert.match(
    docs["docs/runbooks/workspace-architecture-verification.md"],
    /USER\.md missing[\s\S]+User\/USER\.md exists[\s\S]+Workspace Routing present[\s\S]+legacy Space missing/,
  );
});
