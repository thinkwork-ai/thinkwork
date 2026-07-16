import { execFileSync, spawnSync } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { Command } from "commander";
import { capabilityVerifierFromKey } from "@thinkwork/api/src/lib/capabilities/sidecar-signing.js";
import type { CapabilityVerifier } from "@thinkwork/api/src/lib/capabilities/sidecar-signing.js";
import type { CapabilityScopeRef } from "@thinkwork/api/src/lib/capabilities/approval-registry.js";
import {
  migrateSidecarRetirement,
  type SidecarBindingInput,
  type SidecarRetirementMode,
  type SidecarRetirementScopeDb,
} from "../lib/migrations/sidecar-retirement-mover.js";
import {
  AwsCliWorkspaceObjectStore,
  resolveWorkspaceBucketFromLambda,
} from "./migrate-folder-canon.js";

/**
 * `thinkwork sidecar-retirement-mover` (THINK-302 U9).
 *
 * Backfills every tenant `.assignment.json` sidecar into `capability_approvals`
 * bindings + marker frontmatter so the tenant can be flipped to registry-trust
 * without losing grants. Dry-run by default; `--apply` mutates and deletes the
 * sidecars LAST. See `../lib/migrations/sidecar-retirement-mover.ts` for the
 * clean-vs-drift ladder — the pure, unit-tested core this command wires to real
 * S3 / psql / signing-key implementations.
 */
export function registerSidecarRetirementMoverCommand(program: Command): void {
  program
    .command("sidecar-retirement-mover")
    .description(
      "Backfill legacy .assignment.json sidecars into capability_approvals bindings + marker frontmatter (THINK-302 U9). Run only against a stack on the registry-trust writers. Dry-run by default.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug to migrate")
    .option("--agent <slug>", "Limit to one agent slug under the tenant")
    .option("--workspace-bucket <bucket>", "Workspace S3 bucket override")
    .option(
      "--db-endpoint <host>",
      "Aurora cluster endpoint (host). Required for --apply and scope resolution.",
    )
    .option(
      "--signing-public-key-secret <name>",
      "Secrets Manager secret with the capability signing PUBLIC key (default thinkwork/<stage>/capability-signing-public-key)",
    )
    .option("--dry-run", "Read and report the per-folder plan without mutating")
    .option(
      "--apply",
      "Apply: merge frontmatter, record bindings, delete sidecars",
    )
    .action(async (opts, cmd) => {
      const parent = cmd.parent as Command | undefined;
      const stage: string | undefined = opts.stage ?? parent?.opts().stage;
      const mode = resolveMode(opts);
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

      const verifier = resolveVerifier(
        opts.signingPublicKeySecret ??
          (stage ? `thinkwork/${stage}/capability-signing-public-key` : null),
      );
      if (!verifier) {
        console.warn(
          "[sidecar-retirement-mover] public verify key unavailable — enveloped connection/tool sidecars will be treated as withheld (no binding).",
        );
      }

      const conn = resolveDbConnection(stage, opts.dbEndpoint);
      const db = makePsqlScopeDb(conn);
      const recordBinding = makePsqlBindingWriter(conn, mode);

      const summary = await migrateSidecarRetirement({
        store: new AwsCliWorkspaceObjectStore(bucket),
        db,
        recordBinding,
        verifier,
        tenantSlug: opts.tenant,
        agentSlug: opts.agent,
        mode,
      });
      console.log(JSON.stringify(summary, null, 2));
    });
}

function resolveMode(opts: Record<string, unknown>): SidecarRetirementMode {
  if (opts.apply && opts.dryRun) {
    throw new Error("Choose only one of --dry-run or --apply.");
  }
  return opts.apply ? "apply" : "dry-run";
}

function resolveVerifier(secretName: string | null): CapabilityVerifier | null {
  if (!secretName) return null;
  try {
    const pem = execFileSync(
      "aws",
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secretName,
        "--query",
        "SecretString",
        "--output",
        "text",
      ],
      { encoding: "utf8" },
    ).trim();
    if (!pem || pem === "None") return null;
    return capabilityVerifierFromKey(
      createPublicKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem),
    );
  } catch {
    return null;
  }
}

interface PsqlConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Direct-connection credentials for the stage database (clusters are publicly
 * accessible by platform design — same posture `db:push` / schema-apply rely
 * on). Mirrors deploy.ts `resolveStageDbConnection` but takes the endpoint as a
 * flag so this command needs no terraform working directory.
 */
function resolveDbConnection(
  stage: string | undefined,
  endpoint: string | undefined,
): PsqlConnection {
  if (!endpoint) {
    throw new Error(
      "Database endpoint is required. Pass --db-endpoint <aurora-cluster-endpoint>.",
    );
  }
  if (!stage) {
    throw new Error("--stage is required to resolve database credentials.");
  }
  const creds = spawnSync(
    "aws",
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      `thinkwork-${stage}-db-credentials`,
      "--query",
      "SecretString",
      "--output",
      "text",
    ],
    { encoding: "utf8" },
  );
  if (creds.status !== 0) {
    throw new Error(
      `Could not read thinkwork-${stage}-db-credentials: ${(creds.stderr ?? "").trim().slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(creds.stdout) as {
    username?: string;
    password?: string;
  };
  if (!parsed.username || !parsed.password) {
    throw new Error(
      `Secret thinkwork-${stage}-db-credentials is missing username/password.`,
    );
  }
  return {
    host: endpoint,
    port: 5432,
    user: parsed.username,
    password: parsed.password,
    database: "thinkwork",
  };
}

function psqlUrl(conn: PsqlConnection): string {
  return `postgresql://${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password)}@${conn.host}:${conn.port}/${conn.database}?sslmode=prefer`;
}

/** Run a query, returning rows as tab-separated column arrays. */
function psqlRows(conn: PsqlConnection, sql: string): string[][] {
  const proc = spawnSync(
    "psql",
    [
      psqlUrl(conn),
      "-v",
      "ON_ERROR_STOP=1",
      "-X",
      "-q",
      "-t",
      "-A",
      "-F",
      "\t",
      "-c",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (proc.status !== 0) {
    throw new Error(
      (proc.stderr || proc.stdout || "psql failed").trim().slice(0, 600),
    );
  }
  return (proc.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

/** SQL string literal ('' escaping). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The "DB seam": resolve slugs → binding scope + MCP provenance via psql. */
function makePsqlScopeDb(conn: PsqlConnection): SidecarRetirementScopeDb {
  return {
    async resolveScope(input) {
      const rows = psqlRows(
        conn,
        `SELECT a.id, a.tenant_id FROM agents a
           JOIN tenants t ON t.id = a.tenant_id
          WHERE t.slug = ${lit(input.tenantSlug)}
            AND (a.workspace_folder_name = ${lit(input.agentFolder)}
                 OR a.slug = ${lit(input.agentFolder)})
          LIMIT 1;`,
      );
      const row = rows[0];
      if (!row || !row[0] || !row[1]) return null;
      const agentId = row[0];
      const tenantId = row[1];
      const scopeRef: CapabilityScopeRef = input.subAgentSlug
        ? `agent:${agentId}/sub:${input.subAgentSlug}`
        : `agent:${agentId}`;
      return { tenantId, scopeRef };
    },
    async mcpOrigin(input) {
      const rows = psqlRows(
        conn,
        `SELECT s.management_source FROM tenant_mcp_servers s
           JOIN tenants t ON t.id = s.tenant_id
          WHERE t.slug = ${lit(input.tenantSlug)}
            AND s.slug = ${lit(input.slug)}
          LIMIT 1;`,
      );
      const source = rows[0]?.[0];
      if (!source) return null;
      return source === "plugin" ? "plugin-reconciler" : "operator-installed";
    },
  };
}

/**
 * The "binding-writer seam": INSERT into capability_approvals. `origin` is
 * report-only (there is no such column); the row carries the class/slug/sha
 * trio + preserved signed_by/signed_at. Dry-run never writes.
 */
function makePsqlBindingWriter(
  conn: PsqlConnection,
  mode: SidecarRetirementMode,
): (input: SidecarBindingInput) => Promise<void> {
  return async (input: SidecarBindingInput) => {
    if (mode !== "apply") return;
    const signedAt = input.signedAt
      ? `${lit(input.signedAt)}::timestamptz`
      : "now()";
    psqlRows(
      conn,
      `INSERT INTO capability_approvals
         (tenant_id, scope_ref, class, slug, marker_sha, folder_attestation_sha, signed_by, signed_at)
       VALUES
         (${lit(input.tenantId)}, ${lit(input.scopeRef)}, ${lit(input.class)}, ${lit(input.slug)},
          ${lit(input.markerSha)}, ${lit(input.folderAttestationSha)}, ${lit(input.signedBy)}, ${signedAt});`,
    );
  };
}
