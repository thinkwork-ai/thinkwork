import type { GraphQLContext } from "../../context.js";
import {
  activationSessionToGraphql,
  applyOperatingModel,
  assertActivationAccess,
  loadActivationSession,
  parseAwsJson,
} from "./shared.js";

export const applyActivationBundle = async (
  _parent: unknown,
  args: {
    input: {
      sessionId: string;
      applyId: string;
      approvals: Array<{
        itemId: string;
        layer: string;
        action: string;
        target?: string | null;
        payload: string;
      }>;
    };
  },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.input.sessionId);
  await assertActivationAccess(ctx, session);
  const approvals = args.input.approvals.map((approval) => ({
    ...approval,
    payload: parseAwsJson(approval.payload, "approval.payload"),
  }));
  const updated = await applyOperatingModel(
    session,
    args.input.applyId,
    approvals,
  );
  return activationSessionToGraphql(updated);
};
