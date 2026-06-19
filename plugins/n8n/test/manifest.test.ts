import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { n8nDraftManifest, N8N_PUBLICATION_GATES } from "../src/manifest";
import { n8nPluginScaffold } from "../src/index";

describe("n8n plugin scaffold", () => {
  it("declares n8n package ownership without publishing a final manifest", () => {
    expect(n8nPluginScaffold).toMatchObject({
      packageKey: "n8n",
      sourceRoot: "plugins/n8n",
      draftManifest: n8nDraftManifest,
      compatibilityLinks: [],
      publicationStatus: "deferred",
    });
    expect("manifest" in n8nPluginScaffold).toBe(false);
    expect(n8nPluginScaffold.ownedSources.map((source) => source.kind)).toEqual(
      [
        "manifest",
        "deployment",
        "terraform",
        "runtime",
        "web",
        "smoke",
        "tests",
        "docs",
      ],
    );
  });

  it("records the draft manifest intent and publication gates", () => {
    expect(n8nDraftManifest.pluginKey).toBe("n8n");
    expect(n8nDraftManifest.plannedVersion).toBe("0.1.0");
    expect(n8nDraftManifest.publicationStatus).toBe("draft-scaffold");
    expect(
      n8nDraftManifest.plannedComponents.map((component) => component.type),
    ).toEqual(["infrastructure", "mcp-server", "ui-surface", "skills"]);
    expect(N8N_PUBLICATION_GATES.map((gate) => gate.unit)).toEqual([
      "U2",
      "U5",
      "U7",
    ]);
    expect(
      n8nDraftManifest.plannedComponents.find(
        (component) => component.type === "infrastructure",
      ),
    ).toMatchObject({
      plannedManagedAppKey: "n8n",
      publicationGate: "U2",
    });
    expect(
      n8nDraftManifest.plannedComponents.find(
        (component) => component.type === "mcp-server",
      ),
    ).toMatchObject({
      endpointPath: "/mcp-server/http",
      serviceCredentialKind: "n8n-mcp-access-token",
      serviceCredentialSecretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
      publicationGate: "U5",
    });
  });

  it("keeps LastMile runtime source out of the n8n package scaffold", async () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const packagePaths = await listPackagePaths(packageRoot);
    expect(
      packagePaths.filter((path) =>
        /lastmile|custom-node|credential/i.test(path),
      ),
    ).toEqual([]);
    expect(n8nDraftManifest.excludedRuntimeSource).toContain(
      "LastMile custom nodes",
    );
  });
});

async function listPackagePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        paths.push(absolutePath.slice(root.length + 1).replaceAll("\\", "/"));
      }
    }
  }
  await walk(root);
  return paths.sort();
}
