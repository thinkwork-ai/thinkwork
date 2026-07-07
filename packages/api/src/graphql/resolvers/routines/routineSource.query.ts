/**
 * routineSource query (deterministic routines v1) — read a git_python
 * routine's source files (module + fixtures) from the connected GitHub repo
 * so the web app can show the code in-app (Routine Detail → Code tab).
 *
 * Files are read live via the stored `routine-repo` tenant credential, at the
 * routine's validated commit when present (else the repo branch HEAD). This
 * mirrors the executor/agent read path (packages/lambda readRoutineRepo) but
 * lives in the API so the web layer never needs a GitHub token.
 */

import { and, eq } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { routines, tenantCredentials } from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { parseGithubRepoUrl } from "../../../lib/routines/repo-connection.js";
import { readTenantCredentialSecret } from "../../../lib/tenant-credentials/secret-store.js";

const ROUTINE_REPO_CREDENTIAL_SLUG = "routine-repo";

interface RoutineSourceFile {
  path: string;
  content: string;
  language: string;
}

/** Coarse language hint for the editor, from the file extension. */
function languageFor(path: string): string {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  return "text";
}

async function assertCanReadTenant(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<void> {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (callerTenantId === tenantId) return;
  await requireTenantMember(ctx, tenantId);
}

export async function routineSource(
  _parent: unknown,
  args: { routineId: string },
  ctx: GraphQLContext,
): Promise<{ routineId: string; ref: string; files: RoutineSourceFile[] }> {
  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, args.routineId))
    .limit(1);
  if (!routine || routine.engine !== "git_python") {
    throw new GraphQLError("Routine not found.", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await assertCanReadTenant(ctx, routine.tenant_id);

  if (!routine.module_path) {
    throw new GraphQLError("This routine has no module path to read.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const [credential] = await db
    .select({ secretRef: tenantCredentials.secret_ref })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, routine.tenant_id),
        eq(tenantCredentials.slug, ROUTINE_REPO_CREDENTIAL_SLUG),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);
  if (!credential?.secretRef) {
    throw new GraphQLError(
      "No routine repo is connected — connect one under Settings → Routines.",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const secret = (await readTenantCredentialSecret(credential.secretRef)) as {
    repoUrl?: string;
    token?: string;
    branch?: string;
  };
  if (!secret.repoUrl || !secret.token || !secret.branch) {
    throw new GraphQLError(
      "The routine repo credential is missing repoUrl/token/branch.",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const { owner, repo } = parseGithubRepoUrl(secret.repoUrl);
  const octokit = new Octokit({ auth: secret.token });

  // Validated commit is the trustworthy pinned source; fall back to the
  // branch HEAD for routines that have not been validated yet.
  let ref = routine.validated_sha ?? null;
  if (!ref) {
    const head = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${secret.branch}`,
    });
    ref = head.data.object.sha;
  }

  const fixturePaths = Array.isArray(routine.fixture_paths)
    ? (routine.fixture_paths as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  const paths = [routine.module_path, ...fixturePaths];

  const files: RoutineSourceFile[] = [];
  for (const path of paths) {
    try {
      const res = await octokit.repos.getContent({ owner, repo, path, ref });
      const data = res.data as { content?: string; encoding?: string };
      if (!data.content) throw new Error("file has no content");
      const content = Buffer.from(
        data.content,
        (data.encoding as BufferEncoding) ?? "base64",
      ).toString("utf-8");
      files.push({ path, content, language: languageFor(path) });
    } catch (err) {
      files.push({
        path,
        content: `<<unreadable: ${(err as Error).message}>>`,
        language: languageFor(path),
      });
    }
  }

  return { routineId: routine.id, ref, files };
}
