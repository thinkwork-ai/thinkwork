import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThinkWorkReleaseManifest } from "@thinkwork/release-manifest";

const { selectQueue, returningQueue, insertCalls, updateCalls, mockDb } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const returningQueue: unknown[][] = [];
    const insertCalls: Array<Record<string, unknown>> = [];
    const updateCalls: Array<Record<string, unknown>> = [];
    const mockDb = {
      select: vi.fn(() => {
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => selectQueue.shift() ?? []),
          orderBy: vi.fn(async () => selectQueue.shift() ?? []),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return {
            returning: async () => [
              {
                ...values,
                created_at: new Date("2026-06-14T20:00:00Z"),
                updated_at: new Date("2026-06-14T20:00:00Z"),
              },
            ],
            onConflictDoNothing: async () => [],
            then: (resolve: (value: unknown[]) => void) => resolve([]),
          };
        },
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return {
            where: () => ({
              returning: async () => returningQueue.shift() ?? [],
            }),
          };
        },
      })),
    };
    return { selectQueue, returningQueue, insertCalls, updateCalls, mockDb };
  });

vi.mock("../../graphql/utils.js", () => ({
  db: mockDb,
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
        value,
      ]),
    ),
}));

let preflightMod: typeof import("./release-preflight.js");

const runnerBytes = Buffer.from("release runner v187\n");
const runnerSha = sha256(runnerBytes);
const manifest = buildManifest({
  version: "v0.1.0-canary.187",
  runnerSha,
});
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestSha = sha256(manifestBytes);

beforeEach(async () => {
  vi.resetModules();
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  mockDb.update.mockClear();
  preflightMod = await import("./release-preflight.js");
});

describe("release update preflight", () => {
  it("persists a ready preflight with preserved customer-domain config", async () => {
    selectQueue.push([]);
    selectQueue.push([{ id: "event-1", event_type: "preflight_ready" }]);

    const result = await runPreflight({
      iamPolicies: [{ Statement: [{ Effect: "Allow", Action: "route53:*" }] }],
    });

    expect(result.job.status).toBe("preflight_ready");
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "preflight_ready",
          current_release_version: "v0.1.0-canary.178",
          target_release_version: "v0.1.0-canary.187",
          manifest_sha256: manifestSha,
          manifest_trust_policy: "allow_unsigned_canary",
          terraform_module_version: "0.1.0-canary.187",
          preflight_summary: expect.objectContaining({
            blocked: false,
            runner: expect.objectContaining({
              status: "compatible",
              currentSha256: runnerSha,
            }),
            iam: expect.objectContaining({ status: "ok" }),
          }),
          preserved_config_summary: expect.objectContaining({
            available: true,
            fields: expect.objectContaining({
              customerDomain: "tei.thinkwork.ai",
              customerDomainDelegated: true,
              customerDomainLegacyRetired: false,
              googleOauthClientIdConfigured: true,
            }),
          }),
        }),
      ]),
    );
  });

  it("blocks when the frozen S3 runner hash does not match the target release", async () => {
    selectQueue.push([]);
    selectQueue.push([{ id: "event-1", event_type: "preflight_blocked" }]);

    const result = await runPreflight({
      runnerObject: Buffer.from("old runner\n"),
      iamPolicies: [{ Statement: [{ Effect: "Allow", Action: "route53:*" }] }],
    });

    expect(result.job.status).toBe("preflight_blocked");
    expect(result.job.failure_category).toBe("runner_compatibility");
    expect(result.job.remediation_summary).toMatchObject({
      runnerRefresh: {
        required: true,
        available: true,
      },
    });
  });

  it("blocks customer-domain upgrades when the CodeBuild role lacks Route53", async () => {
    selectQueue.push([]);
    selectQueue.push([{ id: "event-1", event_type: "preflight_blocked" }]);

    const result = await runPreflight({
      iamPolicies: [
        { Statement: [{ Effect: "Allow", Action: ["s3:*", "lambda:*"] }] },
      ],
    });

    expect(result.job.status).toBe("preflight_blocked");
    expect(result.job.failure_category).toBe("iam_route53_missing");
    expect(result.job.preflight_summary).toMatchObject({
      iam: {
        status: "missing_route53",
        requiresRoute53: true,
      },
    });
  });

  it("fails closed when previous redacted Terraform vars are unavailable", async () => {
    selectQueue.push([]);
    selectQueue.push([{ id: "event-1", event_type: "preflight_blocked" }]);

    const result = await runPreflight({
      omitRedactedVars: true,
      iamPolicies: [],
    });

    expect(result.job.status).toBe("preflight_blocked");
    expect(result.job.failure_category).toBe("preserved_config_unavailable");
    expect(result.job.preserved_config_summary).toMatchObject({
      available: false,
    });
  });

  it("backs up and refreshes a stale runner with evidence", async () => {
    const oldRunner = Buffer.from("old runner\n");
    const writeCalls: Array<{
      bucket: string;
      key: string;
      body: Uint8Array | string;
      contentType?: string;
    }> = [];
    selectQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        status: "preflight_blocked",
        target_release_version: "v0.1.0-canary.187",
        current_release_version: "v0.1.0-canary.178",
        manifest_url:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json",
        manifest_sha256: manifestSha,
        manifest_signed: false,
        manifest_trust_policy: "allow_unsigned_canary",
        terraform_module_version: "0.1.0-canary.187",
        preflight_summary: {
          blocked: true,
          blockers: [
            {
              category: "runner_compatibility",
              message: "Runner refresh required.",
              recoveryAction: "Refresh runner.",
            },
          ],
          runner: {
            status: "mismatch",
            currentSha256: sha256(oldRunner),
            targetSha256: runnerSha,
          },
        },
        preserved_config_summary: { available: true },
        remediation_summary: {
          runnerRefresh: {
            required: true,
            available: true,
            source: {
              url: "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-runner.py",
              sha256: runnerSha,
            },
          },
        },
        evidence_bucket: "thinkwork-tei-e2e-deploy-evidence",
      },
    ]);
    returningQueue.push([
      {
        id: "job-1",
        tenant_id: "tenant-1",
        status: "runner_remediated",
        remediation_summary: {},
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "runner_remediated" }]);

    const result = await preflightMod.remediateReleaseRunnerJob(
      {
        tenantId: "tenant-1",
        requestedByUserId: "user-1",
        jobId: "job-1",
        idempotencyKey: "remediate-1",
      },
      {
        now: () => new Date("2026-06-14T21:00:00.000Z"),
        fetch: vi.fn(async () => ({
          ok: true,
          arrayBuffer: async () => runnerBytes,
        })) as any,
        readS3Object: async (_bucket, key) =>
          key === "runner/thinkwork-runner.py" ? oldRunner : null,
        writeS3Object: async (bucket, key, body, contentType) => {
          writeCalls.push({ bucket, key, body, contentType });
        },
      },
    );

    expect(result.job.status).toBe("runner_remediated");
    expect(writeCalls.map((call) => call.key)).toEqual([
      "runner/backups/20260614T210000000Z-job-1-thinkwork-runner.py",
      "runner/thinkwork-runner.py",
      "release-updates/job-1/runner-remediation/20260614T210000000Z.json",
    ]);
    expect(Buffer.from(writeCalls[1].body as Uint8Array).toString("utf8")).toBe(
      runnerBytes.toString("utf8"),
    );
    expect(updateCalls[0]).toMatchObject({
      status: "runner_remediated",
      failure_category: undefined,
      remediation_summary: {
        runnerRefresh: {
          required: false,
          completed: true,
          backupKey:
            "runner/backups/20260614T210000000Z-job-1-thinkwork-runner.py",
          evidenceKey:
            "release-updates/job-1/runner-remediation/20260614T210000000Z.json",
          previousSha256: sha256(oldRunner),
          targetSha256: runnerSha,
        },
      },
    });
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "runner_remediated" }),
      ]),
    );
  });
});

async function runPreflight(options: {
  runnerObject?: Buffer;
  omitRedactedVars?: boolean;
  iamPolicies: Array<Record<string, unknown>>;
}) {
  return preflightMod.startReleaseUpdatePreflightJob(
    {
      tenantId: "tenant-1",
      requestedByUserId: "user-1",
      version: "v0.1.0-canary.187",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/thinkwork-release.json",
      manifestSha256: manifestSha,
      signed: false,
      idempotencyKey: "preflight-1",
    },
    {
      fetch: vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => manifestBytes,
      })) as any,
      profile: {
        releaseVersion: "v0.1.0-canary.178",
        releaseManifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.178/thinkwork-release.json",
        releaseManifestSha256: "b".repeat(64),
        releaseManifestSignatureUrl: null,
        releaseManifestTrustPolicy: "allow_unsigned_canary",
        releaseManifestTrustedKeysJson: null,
        stateMachineArn: "arn:aws:states:us-east-1:123:stateMachine:deploy",
        evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
        runnerProjectName: "thinkwork-tei-e2e-deployment-runner",
      },
      readReleaseSelection: async () => ({}),
      readS3Object: async (_bucket, key) => {
        if (key === "deployment/status/current.json") {
          return Buffer.from(
            JSON.stringify({
              activeRelease: {
                version: "v0.1.0-canary.178",
                manifestUrl:
                  "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.178/thinkwork-release.json",
                manifestSha256: "b".repeat(64),
              },
              lastSuccessfulDeployment: {
                evidenceKey: "sessions/last/deployment-evidence.json",
              },
            }),
          );
        }
        if (key === "runner/thinkwork-runner.py") {
          return options.runnerObject ?? runnerBytes;
        }
        if (key === "sessions/last/redacted-terraform-vars.json") {
          return options.omitRedactedVars
            ? null
            : Buffer.from(
                JSON.stringify({
                  customer_domain: "tei.thinkwork.ai",
                  customer_domain_delegated: true,
                  customer_domain_legacy_retired: false,
                  cognito_email_source_arn:
                    "arn:aws:ses:us-east-1:123:identity/tei.thinkwork.ai",
                  cognito_from_email_address: "hello@tei.thinkwork.ai",
                  cognito_reply_to_email_address: "support@tei.thinkwork.ai",
                  platform_operator_emails: "ops@tei.thinkwork.ai",
                  google_oauth_client_id: "google-client",
                }),
              );
        }
        return null;
      },
      readCodeBuildServiceRoleArn: async () =>
        "arn:aws:iam::123:role/thinkwork-tei-e2e-deployment-codebuild-role",
      readIamPolicyDocuments: async () => options.iamPolicies,
    },
  );
}

function buildManifest(args: {
  version: string;
  runnerSha: string;
}): ThinkWorkReleaseManifest {
  return {
    schemaVersion: 1,
    release: {
      version: args.version,
      gitSha: "f".repeat(40),
      createdAt: "2026-06-14T18:00:00.000Z",
    },
    compatibility: {
      minCliVersion: args.version,
      minRunnerVersion: args.version,
      profileSchemaVersion: 1,
    },
    components: {
      cli: { version: args.version },
      terraform: {
        source: "thinkwork-ai/thinkwork/aws",
        version: "0.1.0-canary.187",
      },
      deploymentRunner: {
        version: args.version,
        image: null,
        script: {
          fileName: "thinkwork-runner.py",
          relativePath: "runner/thinkwork-runner.py",
          url: "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.187/platform-artifacts.tar.gz",
          sha256: args.runnerSha,
          sizeBytes: runnerBytes.length,
        },
      },
      customerOverlay: { schemaVersion: 1 },
    },
    artifactBundles: [],
    artifacts: [],
    runtimeImages: [],
    managedApps: [],
    signing: {
      acceptedKeyIds: [],
      revokedKeyIds: [],
    },
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
