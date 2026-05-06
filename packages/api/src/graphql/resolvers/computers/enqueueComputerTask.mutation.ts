import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, computers } from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  ComputerTaskInputError,
  enqueueComputerTask as enqueueTask,
  parseComputerTaskType,
} from "../../../lib/computers/tasks.js";
import { requireComputerReadAccess } from "./shared.js";

export async function enqueueComputerTask(
  _parent: any,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const [computer] = await db
    .select()
    .from(computers)
    .where(eq(computers.id, args.input.computerId));
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireComputerReadAccess(ctx, computer);

  const taskType = parseComputerTaskType(args.input.taskType);
  const callerUserId = await resolveCallerUserId(ctx);
  try {
    return await enqueueTask({
      tenantId: computer.tenant_id,
      computerId: computer.id,
      taskType,
      taskInput: args.input.input,
      idempotencyKey: normalizeIdempotencyKey(args.input.idempotencyKey),
      createdByUserId: callerUserId,
    });
  } catch (err) {
    if (err instanceof ComputerTaskInputError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }
}

function normalizeIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
