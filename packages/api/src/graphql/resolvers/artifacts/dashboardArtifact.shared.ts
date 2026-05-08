import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  artifactToCamel,
  artifacts,
  computerTasks,
  db,
  desc,
  eq,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  assertDashboardArtifactAccess,
  type DashboardArtifactMetadata,
  type DashboardArtifactRow,
} from "../../../lib/dashboard-artifacts/access.js";
import {
  readDashboardManifestFromS3,
} from "../../../lib/dashboard-artifacts/storage.js";
import {
  DashboardManifestValidationError,
  type DashboardManifestV1,
  type DashboardRecipeStepV1,
} from "../../../lib/dashboard-artifacts/manifest.js";
import { toGraphqlComputerTask } from "../../../lib/computers/tasks.js";

const READ_ONLY_RECIPE_STEPS = new Set<DashboardRecipeStepV1["type"]>([
  "source_query",
  "transform",
  "score",
  "template_summary",
]);

export async function loadDashboardArtifact(args: {
  id: string;
  ctx: GraphQLContext;
  caller?: { tenantId: string | null; userId: string | null };
}): Promise<{
  artifact: DashboardArtifactRow & Record<string, unknown>;
  metadata: DashboardArtifactMetadata;
  manifest: DashboardManifestV1;
}> {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.id));
  if (!row) {
    throw notFound();
  }

  const caller = args.caller ?? (await resolveCaller(args.ctx));
  const metadata = assertDashboardArtifactAccess(row, caller);
  const manifest = await readManifest(row);
  if (manifest.snapshot.artifactId !== row.id) {
    throw badDashboardArtifact("Dashboard manifest does not match artifact");
  }
  if (metadata.threadId && metadata.threadId !== manifest.snapshot.threadId) {
    throw badDashboardArtifact("Dashboard manifest thread linkage is invalid");
  }

  return { artifact: row, metadata, manifest };
}

export async function toDashboardArtifactPayload(input: {
  artifact: DashboardArtifactRow & Record<string, unknown>;
  metadata: DashboardArtifactMetadata;
  manifest: DashboardManifestV1;
}) {
  return {
    artifact: artifactToCamel(input.artifact),
    manifest: input.manifest,
    latestRefreshTask: await loadLatestRefreshTask(input),
    canRefresh: canRefreshDashboard(input.metadata, input.manifest),
  };
}

export function dashboardRefreshIdempotencyKey(input: {
  artifactId: string;
  recipeVersion: number;
}): string {
  return `dashboard-artifact-refresh:${input.artifactId}:${input.recipeVersion}`;
}

export function assertReadOnlyDashboardRecipe(manifest: DashboardManifestV1) {
  if (!isReadOnlyDashboardRecipe(manifest)) {
    throw badDashboardArtifact("Dashboard refresh recipe is not read-only");
  }
}

function canRefreshDashboard(
  metadata: DashboardArtifactMetadata,
  manifest: DashboardManifestV1,
): boolean {
  return Boolean(
    metadata.computerId &&
      manifest.refresh.enabled &&
      isReadOnlyDashboardRecipe(manifest),
  );
}

function isReadOnlyDashboardRecipe(manifest: DashboardManifestV1): boolean {
  return manifest.recipe.steps.every((step) =>
    READ_ONLY_RECIPE_STEPS.has(step.type),
  );
}

async function readManifest(
  artifact: DashboardArtifactRow,
): Promise<DashboardManifestV1> {
  try {
    return await readDashboardManifestFromS3({
      tenantId: artifact.tenant_id,
      key: artifact.s3_key ?? "",
    });
  } catch (err) {
    throw new GraphQLError("Dashboard manifest is unavailable", {
      extensions: {
        code:
          err instanceof SyntaxError ||
          err instanceof DashboardManifestValidationError
            ? "BAD_USER_INPUT"
            : "SERVICE_UNAVAILABLE",
      },
    });
  }
}

async function loadLatestRefreshTask(input: {
  artifact: DashboardArtifactRow & Record<string, unknown>;
  metadata: DashboardArtifactMetadata;
  manifest: DashboardManifestV1;
}) {
  if (!input.metadata.computerId) return null;
  const [task] = await db
    .select()
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.artifact.tenant_id),
        eq(computerTasks.computer_id, input.metadata.computerId),
        eq(
          computerTasks.idempotency_key,
          dashboardRefreshIdempotencyKey({
            artifactId: input.artifact.id,
            recipeVersion: input.manifest.refresh.recipeVersion,
          }),
        ),
      ),
    )
    .orderBy(desc(computerTasks.created_at))
    .limit(1);
  return task ? toGraphqlComputerTask(task) : null;
}

function notFound() {
  return new GraphQLError("Dashboard artifact not found", {
    extensions: { code: "NOT_FOUND" },
  });
}

function badDashboardArtifact(message: string) {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
