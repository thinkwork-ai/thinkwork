import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  filesEtagSignature,
  runScriptToolTrustGate,
  type ScriptToolTrustField,
} from "./script-trust.js";
import { compileCapabilitiesManifest } from "./manifest-compile.js";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  signCapabilitySidecar,
} from "./sidecar-signing.js";

const PREFIX = "tenants/acme/agents/ops/";
const TOOL_MD = `---
name: cruncher
description: Crunch CSVs.
kind: script
entry: run.sh
---
Cruncher.
`;

function fakeS3(seed: Record<string, { content: string; etag: string }>) {
  const objects = new Map(Object.entries(seed));
  return {
    send: vi.fn(async (command: any) => {
      const name = command.constructor.name;
      if (name === "ListObjectsV2Command") {
        const prefix = command.input.Prefix as string;
        return {
          Contents: [...objects.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ Key: key, ETag: value.etag })),
        };
      }
      if (name === "GetObjectCommand") {
        const entry = objects.get(command.input.Key as string);
        if (!entry)
          throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return { Body: { transformToString: async () => entry.content } };
      }
      throw new Error(`unexpected ${name}`);
    }),
  };
}

const seed = {
  [`${PREFIX}tools/cruncher/TOOL.md`]: { content: TOOL_MD, etag: '"e1"' },
  [`${PREFIX}tools/cruncher/run.sh`]: {
    content: "#!/bin/bash\necho ok\n",
    etag: '"e2"',
  },
};

const completedScan = (findings: any[] = []) =>
  vi.fn(async (input: { slug: string; files: Array<{ path: string }> }) => {
    void input;
    return { scanner: { status: "completed" as const }, findings };
  });

describe("runScriptToolTrustGate", () => {
  it("passes a clean folder and pins definition sha + files signature", async () => {
    const spector = completedScan();
    const result = await runScriptToolTrustGate({
      targetPrefix: PREFIX,
      slug: "cruncher",
      deps: { s3: fakeS3(seed) as any, bucket: "b", spector },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trust.status).toBe("passed");
    expect(result.trust.files_etag_signature).toBe(
      filesEtagSignature([
        { path: "TOOL.md", etag: '"e1"' },
        { path: "run.sh", etag: '"e2"' },
      ]),
    );
    // The scan saw both files but never the sidecar.
    const scanned =
      spector.mock.calls[0]?.[0]?.files.map((file) => file.path) ?? [];
    expect(scanned.sort()).toEqual(["TOOL.md", "run.sh"]);
  });

  it("fails closed when the scanner is unconfigured or errors", async () => {
    const unconfigured = await runScriptToolTrustGate({
      targetPrefix: PREFIX,
      slug: "cruncher",
      deps: {
        s3: fakeS3(seed) as any,
        bucket: "b",
        spector: vi.fn(async () => ({
          scanner: { status: "not_configured" as const },
          findings: [],
        })),
      },
    });
    expect(unconfigured).toMatchObject({
      ok: false,
      reason: "scanner_unavailable",
    });

    const failed = await runScriptToolTrustGate({
      targetPrefix: PREFIX,
      slug: "cruncher",
      deps: {
        s3: fakeS3(seed) as any,
        bucket: "b",
        spector: vi.fn(async () => ({
          scanner: { status: "failed" as const, error: "boom" },
          findings: [],
        })),
      },
    });
    expect(failed).toMatchObject({ ok: false, reason: "scanner_failed" });
  });

  it("blocks on critical/high findings", async () => {
    const result = await runScriptToolTrustGate({
      targetPrefix: PREFIX,
      slug: "cruncher",
      deps: {
        s3: fakeS3(seed) as any,
        bucket: "b",
        spector: completedScan([
          {
            id: "exfil-1",
            severity: "critical",
            category: "exfiltration",
            message: "curl to unknown host",
          },
        ]),
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
  });
});

describe("manifest compile × script trust (U8 registration precondition)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = capabilitySignerFromKey(privateKey);
  const verifier = capabilityVerifierFromKey(publicKey);

  function signedScriptFolder(
    trust: ScriptToolTrustField | undefined,
    files: Array<{ path: string; etag: string }>,
  ) {
    const base = {
      slug: "cruncher",
      class: "tool" as const,
      enabled: true,
      updated_at: "2026-07-05T00:00:00.000Z",
      ...(trust ? { trust } : {}),
    };
    const { signed_content_sha, signature } = signCapabilitySidecar({
      signer,
      sidecar: base,
      definitionBytes: TOOL_MD,
      signedBy: "operator:u1",
    });
    return {
      class: "tool" as const,
      slug: "cruncher",
      definitionPath: "tools/cruncher/TOOL.md",
      definitionRaw: TOOL_MD,
      sidecarRaw: JSON.stringify({ ...base, signed_content_sha, signature }),
      files,
    };
  }

  const files = [
    { path: "TOOL.md", etag: '"e1"' },
    { path: "run.sh", etag: '"e2"' },
  ];
  const trust = (
    over: Partial<ScriptToolTrustField> = {},
  ): ScriptToolTrustField => ({
    status: "passed",
    // definitionContentSha(TOOL_MD) — computed via signing pin equality.
    content_sha: "",
    files_etag_signature: filesEtagSignature(files),
    scanned_at: "2026-07-05T00:00:00.000Z",
    finding_count: 0,
    ...over,
  });

  function compile(folder: ReturnType<typeof signedScriptFolder>) {
    return compileCapabilitiesManifest({
      agent: { tenantId: "t", agentSlug: "ops" },
      folders: [folder],
      skills: [],
      verifier,
      signer,
      inputSignature: "sig",
      generatedAt: "2026-07-05T00:00:00.000Z",
    }).manifest;
  }

  it("passed + current report registers; etag drift withholds", async () => {
    // Compute the real definition sha by round-tripping the signer pin.
    const { definitionContentSha } = await import("./sidecar-signing.js");
    const goodTrust = trust({ content_sha: definitionContentSha(TOOL_MD) });

    const active = compile(signedScriptFolder(goodTrust, files));
    expect(active.active.some((entry) => entry.slug === "cruncher")).toBe(true);
    expect(active.withheld).toEqual([]);

    const drifted = compile(
      signedScriptFolder(goodTrust, [
        { path: "TOOL.md", etag: '"e1"' },
        { path: "run.sh", etag: '"e3-edited"' },
      ]),
    );
    expect(drifted.withheld).toEqual([
      expect.objectContaining({
        slug: "cruncher",
        reason: "trust_gate",
        detail: expect.stringContaining("changed since the trust scan"),
      }),
    ]);
  });

  it("report pinning a different definition sha is rejected", async () => {
    const wrongSha = trust({ content_sha: "a".repeat(64) });
    const manifest = compile(signedScriptFolder(wrongSha, files));
    expect(manifest.withheld).toEqual([
      expect.objectContaining({ slug: "cruncher", reason: "trust_gate" }),
    ]);
  });

  it("report without a files signature is rejected when files are known", async () => {
    const { definitionContentSha } = await import("./sidecar-signing.js");
    const noFiles = {
      status: "passed",
      content_sha: definitionContentSha(TOOL_MD),
      scanned_at: "2026-07-05T00:00:00.000Z",
      finding_count: 0,
    } as unknown as ScriptToolTrustField;
    const manifest = compile(signedScriptFolder(noFiles, files));
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "cruncher",
        reason: "trust_gate",
        detail: expect.stringContaining("lacks a files signature"),
      }),
    ]);
  });
});
