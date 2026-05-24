import { execFileSync, spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  migrateFolderCanon,
  type FolderCanonMode,
  type WorkspaceObjectStore,
} from "../lib/migrations/folder-canon-migrator.js";

export function registerMigrateFolderCanonCommand(program: Command): void {
  program
    .command("migrate-folder-canon")
    .description(
      "Migrate tenant agent workspaces to the folder-is-the-agent canonical layout.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug to migrate")
    .option("--agent <slug>", "Limit to one agent slug under the tenant")
    .option("--workspace-bucket <bucket>", "Workspace S3 bucket override")
    .option(
      "--snapshot <s3-prefix>",
      "Operate on a copied S3 prefix instead of the live tenant prefix.",
    )
    .option("--dry-run", "Read and report planned changes without mutating")
    .option("--apply", "Apply writes and folder moves")
    .option("--repair", "Apply idempotently after a partial prior run")
    .option(
      "--noop-check",
      "Exit nonzero if any migration operation would still be needed.",
    )
    .action(async (opts, cmd) => {
      const parent = cmd.parent as Command | undefined;
      const mode = resolveMode(opts);
      const stage = opts.stage ?? parent?.opts().stage;
      const bucket =
        opts.workspaceBucket ??
        process.env.WORKSPACE_BUCKET ??
        process.env.AGENTCORE_FILES_BUCKET ??
        (stage ? resolveWorkspaceBucketFromLambda(stage) : null);
      if (!bucket) {
        throw new Error(
          "Workspace bucket is required. Pass --workspace-bucket or set WORKSPACE_BUCKET.",
        );
      }

      const summary = await migrateFolderCanon({
        tenantSlug: opts.tenant,
        agentSlug: opts.agent,
        snapshotPrefix: opts.snapshot,
        mode,
        store: new AwsCliWorkspaceObjectStore(bucket),
      });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.tenantReports.some((report) => report.status === "failed")) {
        process.exitCode = 1;
      }
      if (mode === "noop-check" && summary.pendingOperations > 0) {
        process.exitCode = 2;
      }
    });
}

function resolveMode(opts: Record<string, unknown>): FolderCanonMode {
  const selected = [
    opts.apply ? "apply" : null,
    opts.repair ? "repair" : null,
    opts.noopCheck ? "noop-check" : null,
    opts.dryRun ? "dry-run" : null,
  ].filter(Boolean) as FolderCanonMode[];
  if (selected.length > 1) {
    throw new Error(
      "Choose only one of --dry-run, --apply, --repair, or --noop-check.",
    );
  }
  return selected[0] ?? "dry-run";
}

function resolveWorkspaceBucketFromLambda(stage: string): string | null {
  for (const functionName of [
    `thinkwork-${stage}-api-workspace-files`,
    `thinkwork-${stage}-api-graphql-http`,
    `thinkwork-${stage}-api-tenants`,
  ]) {
    try {
      const value = execFileSync(
        "aws",
        [
          "lambda",
          "get-function-configuration",
          "--function-name",
          functionName,
          "--query",
          "Environment.Variables.WORKSPACE_BUCKET",
          "--output",
          "text",
        ],
        { encoding: "utf8" },
      ).trim();
      if (value && value !== "None") return value;
    } catch {
      // Try the next common Lambda name.
    }
  }
  return null;
}

export class AwsCliWorkspaceObjectStore implements WorkspaceObjectStore {
  constructor(private readonly bucket: string) {}

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const args = [
        "s3api",
        "list-objects-v2",
        "--bucket",
        this.bucket,
        "--prefix",
        prefix,
        "--output",
        "json",
      ];
      if (token) args.push("--continuation-token", token);
      const raw = execFileSync("aws", args, { encoding: "utf8" });
      const parsed = JSON.parse(raw || "{}") as {
        Contents?: Array<{ Key?: string }>;
        NextContinuationToken?: string;
      };
      for (const item of parsed.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      token = parsed.NextContinuationToken ?? null;
    } while (token);
    return keys;
  }

  async read(key: string): Promise<string | null> {
    const result = spawnSync("aws", ["s3", "cp", this.s3Url(key), "-"], {
      encoding: "utf8",
    });
    if (result.status === 0) return result.stdout;
    if (result.stderr.includes("404") || result.stderr.includes("Not Found")) {
      return null;
    }
    throw new Error(result.stderr || `Failed to read ${key}`);
  }

  async write(key: string, body: string): Promise<void> {
    const result = spawnSync("aws", ["s3", "cp", "-", this.s3Url(key)], {
      encoding: "utf8",
      input: body,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `Failed to write ${key}`);
    }
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    execFileSync("aws", [
      "s3",
      "cp",
      this.s3Url(sourceKey),
      this.s3Url(targetKey),
    ]);
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      execFileSync("aws", ["s3", "rm", this.s3Url(key)]);
    }
  }

  private s3Url(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }
}
