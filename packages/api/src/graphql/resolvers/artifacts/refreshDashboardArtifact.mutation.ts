import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  ComputerTaskInputError,
  enqueueComputerTask,
} from "../../../lib/computers/tasks.js";
import {
  completeComputerTask,
  failComputerTask,
} from "../../../lib/computers/runtime-api.js";
import { executeDashboardArtifactRefresh } from "../../../lib/dashboard-artifacts/refresh-executor.js";
import {
  assertReadOnlyDashboardRecipe,
  dashboardRefreshIdempotencyKey,
  loadDashboardArtifact,
} from "./dashboardArtifact.shared.js";
import { artifactToCamel } from "../../utils.js";

export async function refreshDashboardArtifact(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const caller = await resolveCaller(ctx);
  if (!caller.userId) {
    throw new GraphQLError("Dashboard refresh requires a user caller", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const { artifact, metadata, manifest } = await loadDashboardArtifact({
    id: args.id,
    ctx,
    caller,
  });
  if (!metadata.computerId) {
    throw new GraphQLError("Dashboard artifact is not linked to a Computer", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!manifest.refresh.enabled) {
    throw new GraphQLError("Dashboard refresh is disabled", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  assertReadOnlyDashboardRecipe(manifest);

  const idempotencyKey = dashboardRefreshIdempotencyKey({
    artifactId: artifact.id,
    recipeVersion: manifest.refresh.recipeVersion,
  });

  try {
    const task = await enqueueComputerTask({
      tenantId: artifact.tenant_id,
      computerId: metadata.computerId,
      taskType: "dashboard_artifact_refresh",
      taskInput: {
        artifactId: artifact.id,
        requestedByUserId: caller.userId,
        recipeId: manifest.recipe.id,
        recipeVersion: manifest.refresh.recipeVersion,
        dashboardKind: manifest.dashboardKind,
      },
      idempotencyKey,
      createdByUserId: caller.userId,
    });

    if (String(task.status ?? "").toLowerCase() !== "pending") {
      return {
        artifact: artifactToCamel(artifact),
        task,
        idempotencyKey,
      };
    }

    try {
      const refresh = await executeDashboardArtifactRefresh({
        tenantId: artifact.tenant_id,
        manifestKey: artifact.s3_key ?? "",
        manifest,
      });
      const completedTask = await completeComputerTask({
        tenantId: artifact.tenant_id,
        computerId: metadata.computerId,
        taskId: task.id,
        output: refresh.output,
      });

      return {
        artifact: artifactToCamel(artifact),
        task: completedTask,
        idempotencyKey,
      };
    } catch (refreshErr) {
      await failComputerTask({
        tenantId: artifact.tenant_id,
        computerId: metadata.computerId,
        taskId: task.id,
        error: {
          message:
            refreshErr instanceof Error
              ? refreshErr.message
              : String(refreshErr),
        },
      });
      throw refreshErr;
    }
  } catch (err) {
    if (err instanceof ComputerTaskInputError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }
}
