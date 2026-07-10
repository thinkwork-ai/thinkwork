/**
 * Direct-Postgres workspace-member provisioning for TEI's Twenty.
 *
 * WHY THIS EXISTS (2026-07-10): TEI's Twenty deployment does not serve the
 * auth GraphQL schema over its ALB — `sendInvitations`, `signUpInWorkspace`,
 * and `getLoginTokenFromCredentials` all return "Cannot query field" on
 * `/graphql` and `/metadata`, on every header/origin combination, and `/rest`
 * exposes object CRUD only ("object 'auth' not found"). The workspace API key
 * reaches only the workspace-object schema. There is therefore NO API path to
 * create a user. The migration plan names direct Twenty-Postgres writes a stop
 * condition; Eric authorized this route explicitly after that was surfaced.
 *
 * SAFETY POSTURE
 * - INSERT-only. Never updates or deletes an existing row.
 * - Idempotent: a rep whose email already exists in `core.user` is skipped.
 * - One transaction per rep; a failure rolls that rep back and the run
 *   continues, reporting the failure.
 * - Row shapes are copied from the two users the running Twenty created
 *   itself (bcrypt `$2b$10$`, Admin/Member role via `core.roleTarget`,
 *   `workspaceMember` in the workspace schema).
 * - Removal is a plain `DELETE FROM core."user" WHERE email = ...` — the
 *   userWorkspace/roleTarget/workspaceMember rows cascade or are deleted here.
 */

import bcrypt from "bcryptjs";
import pg from "pg";

export interface ProvisionRep {
  repId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface ProvisionRow {
  email: string;
  action: "created" | "exists" | "failed";
  workspaceMemberId?: string;
  error?: string;
}

export interface ProvisionResult {
  rows: ProvisionRow[];
  created: number;
  existing: number;
  failed: number;
}

/**
 * Twenty stores bcrypt `$2b$` hashes. bcryptjs emits the `$2a$` prefix; the
 * two are the same algorithm for passwords under 256 bytes, and bcryptjs
 * itself verifies the rewritten hash. Rewriting keeps the stored shape
 * byte-identical to what Twenty's own signup writes.
 */
export function hashPassword(password: string, rounds = 10): string {
  if (Buffer.byteLength(password, "utf8") > 72) {
    // bcrypt silently truncates past 72 bytes — refuse rather than create a
    // login whose password is not what the operator thinks it is.
    throw new Error("Password exceeds bcrypt's 72-byte limit.");
  }
  const hash = bcrypt.hashSync(password, rounds);
  const rewritten = hash.replace(/^\$2a\$/, "$2b$");
  if (!bcrypt.compareSync(password, rewritten)) {
    throw new Error("bcrypt self-check failed — refusing to write the hash.");
  }
  return rewritten;
}

export interface ProvisionOptions {
  databaseUrl: string;
  workspaceId: string;
  /** Role granted to every provisioned rep — the workspace's default role. */
  roleId: string;
  /** applicationId reused from the workspace's existing roleTarget rows. */
  applicationId: string;
  /** Workspace data schema, e.g. workspace_brl3ypdat40udm5gtn95sozcg. */
  workspaceSchema: string;
  password: string;
  reps: ProvisionRep[];
  dryRun: boolean;
  log?: (message: string) => void;
}

export async function provisionMembers(
  options: ProvisionOptions,
): Promise<ProvisionResult> {
  const { databaseUrl, workspaceId, roleId, applicationId, workspaceSchema } =
    options;
  const log = options.log ?? (() => {});
  const rows: ProvisionRow[] = [];

  // Hash once: every rep shares the validation-window password, and bcrypt at
  // cost 10 is ~100ms — 91 reps would otherwise cost ~10s for no benefit.
  // Distinct salts per rep are not a security gain here because the password
  // is shared and slated for rotation at cutover.
  const passwordHash = hashPassword(options.password);

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const existing = await pool.query<{ email: string }>(
      `select lower(email) as email from core."user" where "deletedAt" is null`,
    );
    const existingEmails = new Set(existing.rows.map((row) => row.email));

    for (const rep of options.reps) {
      const email = rep.email.toLowerCase();
      if (existingEmails.has(email)) {
        rows.push({ email, action: "exists" });
        continue;
      }
      if (options.dryRun) {
        rows.push({ email, action: "created" });
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        const user = await client.query<{ id: string }>(
          `insert into core."user" ("firstName", "lastName", email, "passwordHash", "isEmailVerified")
           values ($1, $2, $3, $4, true)
           returning id`,
          [rep.firstName ?? "", rep.lastName ?? "", email, passwordHash],
        );
        const userId = user.rows[0].id;

        const userWorkspace = await client.query<{ id: string }>(
          `insert into core."userWorkspace" ("userId", "workspaceId")
           values ($1, $2)
           returning id`,
          [userId, workspaceId],
        );
        const userWorkspaceId = userWorkspace.rows[0].id;

        await client.query(
          `insert into core."roleTarget"
             (id, "workspaceId", "roleId", "userWorkspaceId", "createdAt", "updatedAt", "universalIdentifier", "applicationId")
           values (uuid_generate_v4(), $1, $2, $3, now(), now(), uuid_generate_v4(), $4)`,
          [workspaceId, roleId, userWorkspaceId, applicationId],
        );

        const member = await client.query<{ id: string }>(
          `insert into ${quoteIdent(workspaceSchema)}."workspaceMember"
             ("nameFirstName", "nameLastName", "userEmail", "userId")
           values ($1, $2, $3, $4)
           returning id`,
          [rep.firstName ?? "", rep.lastName ?? "", email, userId],
        );

        await client.query("commit");
        existingEmails.add(email);
        rows.push({
          email,
          action: "created",
          workspaceMemberId: member.rows[0].id,
        });
        log(`provisioned ${email}`);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        rows.push({
          email,
          action: "failed",
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : String(error),
        });
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  return {
    rows,
    created: rows.filter((row) => row.action === "created").length,
    existing: rows.filter((row) => row.action === "exists").length,
    failed: rows.filter((row) => row.action === "failed").length,
  };
}

/** Workspace schema names are `workspace_<id>`; reject anything else rather
 * than interpolate an arbitrary identifier into SQL. */
export function quoteIdent(schema: string): string {
  if (!/^workspace_[a-z0-9]+$/.test(schema)) {
    throw new Error(`Refusing unexpected workspace schema name: ${schema}`);
  }
  return `"${schema}"`;
}
