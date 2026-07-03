/**
 * Read-only preview adapter (Composer v1.1 item 1). The rendered workspace is
 * derived, so the adapter conforms to `WorkspaceFilesClient` for the editor
 * shell but REJECTS every write, and surfaces the extra preview metadata the
 * plain client shape can't carry via getManifest / getFilePayload.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_READ_ONLY_MESSAGE,
  createComposerPreviewClient,
  type ComposerQueryRunner,
} from "./composer-preview-client";

function fakeClient(responses: {
  preview?: unknown;
  file?: unknown;
  previewError?: { message: string };
}): ComposerQueryRunner {
  return {
    query: vi.fn((_doc: unknown, variables: Record<string, unknown>) => ({
      toPromise: () =>
        Promise.resolve(
          "path" in variables
            ? {
                data: { workspacePreviewFile: responses.file },
                error: undefined,
              }
            : {
                data: { workspacePreview: responses.preview },
                error: responses.previewError,
              },
        ),
    })),
  } as unknown as ComposerQueryRunner;
}

const VARS = { tenantId: "t-1", spaceId: "space-1", perspectiveUserId: null };

describe("createComposerPreviewClient", () => {
  it("listFiles maps the manifest entries to file metadata", async () => {
    const client = createComposerPreviewClient(
      fakeClient({
        preview: {
          state: "ok",
          stateDetail: null,
          agentId: "agent-1",
          spaceId: "space-1",
          perspectiveUserId: null,
          noUserBaseline: true,
          files: [
            { path: "AGENTS.md", owner: "agent", generated: true, size: 10 },
            {
              path: "Spaces/cs/CONTEXT.md",
              owner: "space",
              generated: true,
              size: 20,
            },
          ],
        },
      }),
      VARS,
    );
    const { files } = await client.listFiles({});
    expect(files.map((f) => f.path)).toEqual([
      "AGENTS.md",
      "Spaces/cs/CONTEXT.md",
    ]);
    expect(files[1].source).toBe("space");
  });

  it("getManifest surfaces generated flags + echoed selection ids", async () => {
    const client = createComposerPreviewClient(
      fakeClient({
        preview: {
          state: "ok",
          stateDetail: null,
          agentId: "agent-1",
          spaceId: "space-1",
          perspectiveUserId: "user-1",
          noUserBaseline: false,
          files: [
            { path: "AGENTS.md", owner: "agent", generated: true, size: 3 },
          ],
        },
      }),
      VARS,
    );
    const manifest = await client.getManifest();
    expect(manifest.agentId).toBe("agent-1");
    expect(manifest.entries[0].generated).toBe(true);
    expect(manifest.noUserBaseline).toBe(false);
  });

  it("getFile returns the rendered content for an ok payload", async () => {
    const client = createComposerPreviewClient(
      fakeClient({
        file: {
          state: "ok",
          stateDetail: null,
          file: { path: "AGENTS.md", owner: "agent", generated: true, size: 3 },
          content: "# body",
        },
      }),
      VARS,
    );
    const result = await client.getFile({}, "AGENTS.md");
    expect(result.content).toBe("# body");
  });

  it("getFile throws on a non-ok payload state", async () => {
    const client = createComposerPreviewClient(
      fakeClient({
        file: {
          state: "not_found",
          stateDetail: "gone",
          file: null,
          content: null,
        },
      }),
      VARS,
    );
    await expect(client.getFile({}, "x")).rejects.toThrow("gone");
  });

  it("rejects putFile and deleteFile — the rendered workspace is read-only", async () => {
    const client = createComposerPreviewClient(fakeClient({}), VARS);
    await expect(client.putFile({}, "AGENTS.md", "x")).rejects.toThrow(
      COMPOSER_READ_ONLY_MESSAGE,
    );
    await expect(client.deleteFile({}, "AGENTS.md")).rejects.toThrow(
      COMPOSER_READ_ONLY_MESSAGE,
    );
  });

  it("propagates transport errors from the preview query", async () => {
    const client = createComposerPreviewClient(
      fakeClient({ preview: null, previewError: { message: "network sad" } }),
      VARS,
    );
    await expect(client.getManifest()).rejects.toMatchObject({
      message: "network sad",
    });
  });
});
