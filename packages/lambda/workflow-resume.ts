/**
 * workflow-resume — Workflow Interpreter task-token resume Lambda
 * (THINK-219).
 *
 * INERT STUB. SDK-invoked by the resolveWorkflowApproval mutation after an
 * operator Approve/Deny on a `waiting_for_human` run. Mirrors
 * `routine-resume.ts`: SendTaskSuccess/SendTaskFailure with
 * already-consumed tolerance. The real handler is wired in THINK-219 U6.
 *
 * Ships inert-first per the plan's deploy ordering (KTD10): U4 registers
 * this handler's source so `handlers.tf` has a source to build, but the
 * handler THROWS until U6 lands. It must never silently no-op.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const handler = async (_event: unknown): Promise<never> => {
  throw new Error("workflow-resume not yet wired (THINK-219 U6)");
};
