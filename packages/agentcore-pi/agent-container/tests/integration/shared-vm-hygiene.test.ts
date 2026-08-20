/**
 * THINK-909 — shared-microVM hygiene.
 *
 * With `AGENTCORE_SESSION_SCOPE=user` one AgentCore microVM serves every
 * thread of a (tenant, agent, user) tuple, so per-turn scratch that used to
 * be harmlessly per-thread now sits on a shared disk. This exercises two
 * sequential turns for the SAME user on DIFFERENT threads against one
 * container context and asserts no cross-thread residue:
 *
 * 1. Transcript scratch — each turn gets its own mkdtemp session dir, which
 *    is removed in the turn's finally block (so thread A's transcript is not
 *    on disk during thread B's turn).
 * 2. Workspace — a rendered-prefix change wipes the workspace dir before
 *    syncing, instead of trusting the incremental delete loop (which
 *    swallows unlink failures).
 *
 * Full end-to-end container concurrency remains out of this harness's reach
 * (see the U9/U16 deferrals in tenant-isolation.test.ts); this is the
 * closest sequential expression of the invariant.
 */

import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import { handleInvocation } from "../../src/server.js";
import { bootstrapWorkspace } from "../../src/runtime/bootstrap-workspace.js";

const payloadFor = (threadId: string) => ({
  tenant_id: "tenant-1",
  user_id: "user-1",
  assistant_id: "agent-1",
  thread_id: threadId,
  tenant_slug: "tenant-1",
  instance_id: "agent-slug",
  trace_id: `trace-${threadId}`,
  message: "Hello pi",
  thinkwork_api_url: "https://api.example.com",
  thinkwork_api_secret: "test-secret-do-not-leak",
});

function deps(runAgentLoop: unknown) {
  return {
    agentCoreClientFactory: () => ({ send: vi.fn() }) as never,
    s3ClientFactory: () => ({ send: vi.fn() }) as never,
    lambdaClientFactory: () => ({ send: vi.fn() }) as never,
    connectMcpServerFactory: (async () => []) as never,
    sessionStoreFactory: () => ({}) as never,
    runAgentLoop: runAgentLoop as never,
    bootstrapWorkspaceImpl: (async () => {}) as never,
    discoverWorkspaceSkillsImpl: (async () => []) as never,
  };
}

let workspaceRoot: string;

beforeEach(async () => {
  delete process.env.MEMORY_ENGINE;
  delete process.env.WORKSPACE_BUCKET;
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "pi-shared-vm-"));
  process.env.WORKSPACE_DIR = path.join(workspaceRoot, "workspace");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workspaceRoot, { recursive: true, force: true });
});

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("two same-user threads on one container context", () => {
  it("leaves no transcript scratch behind between threads", async () => {
    const observed: Array<{ threadId: string; sessionDir: string }> = [];
    const runAgentLoop = async (input: {
      threadId: string;
      sessionDir?: string;
      tools?: Array<{ name: string }>;
    }) => {
      const sessionDir = input.sessionDir ?? "";
      // The dir must exist during the turn…
      expect(await exists(sessionDir)).toBe(true);
      // …and must not already contain another thread's transcript.
      expect(await readdir(sessionDir)).toEqual([]);
      await writeFile(
        path.join(sessionDir, `${input.threadId}.jsonl`),
        '{"role":"user"}\n',
      );
      observed.push({ threadId: input.threadId, sessionDir });
      return {
        content: "stub response",
        modelId: "amazon-bedrock/test-model",
        toolsCalled: [],
        toolInvocations: [],
      };
    };

    const first = await handleInvocation({
      payload: payloadFor("thread-a"),
      deps: deps(runAgentLoop),
    });
    const second = await handleInvocation({
      payload: payloadFor("thread-b"),
      deps: deps(runAgentLoop),
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(observed).toHaveLength(2);
    // Per-turn dirs, not one shared /tmp/pi-sessions.
    expect(observed[0].sessionDir).not.toBe(observed[1].sessionDir);
    expect(path.basename(observed[0].sessionDir)).toMatch(/^pi-sessions-/);
    // Both removed in their turn's finally block.
    expect(await exists(observed[0].sessionDir)).toBe(false);
    expect(await exists(observed[1].sessionDir)).toBe(false);
  });

  it("wipes the workspace when the second thread projects a different prefix", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s3Mock = mockClient(S3Client as any) as any;
    const s3 = new S3Client({ region: "us-east-1" });
    const stub = (prefix: string, files: Record<string, string>) => {
      s3Mock.reset();
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: Object.keys(files).map((rel) => ({
          Key: prefix + rel,
          ETag: `"${prefix}${rel}"`,
        })),
        IsTruncated: false,
      } as never);
      for (const [rel, body] of Object.entries(files)) {
        const bytes = new TextEncoder().encode(body);
        s3Mock.on(GetObjectCommand, { Key: prefix + rel }).resolves({
          Body: { transformToByteArray: async () => bytes } as unknown as never,
        });
      }
    };

    const workspaceDir = path.join(workspaceRoot, "shared-workspace");
    await mkdir(workspaceDir, { recursive: true });
    const threadA = "tenants/tenant-1/threads/thread-a/";
    const threadB = "tenants/tenant-1/threads/thread-b/";

    stub(threadA, {
      "AGENTS.md": "# agent",
      "Space/thread-a-only.md": "confidential to thread A",
    });
    await bootstrapWorkspace(
      "tenant-1",
      "agent-slug",
      workspaceDir,
      s3,
      "bucket",
      { workspacePrefix: threadA },
    );

    stub(threadB, { "AGENTS.md": "# agent" });
    const result = await bootstrapWorkspace(
      "tenant-1",
      "agent-slug",
      workspaceDir,
      s3,
      "bucket",
      { workspacePrefix: threadB },
    );

    expect(result.wiped).toBe(true);
    expect(await readdir(workspaceDir)).toEqual(["AGENTS.md"]);
    expect(await exists(path.join(workspaceDir, "Space"))).toBe(false);
    s3Mock.restore();
  });
});
