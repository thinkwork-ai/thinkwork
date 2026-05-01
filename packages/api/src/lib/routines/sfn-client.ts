/**
 * Shared SFN client + helpers for the Phase B routine resolvers
 * (Plan 2026-05-01-005 §U7).
 *
 * Resolvers run in the graphql-http Lambda; they call SFN's
 * Create/Update/Publish/StartExecution operations during the publish
 * flow and trigger flow. This module owns the singleton client + the
 * naming conventions that bind a routine row to its SFN resources.
 *
 * Naming conventions:
 *   stateMachineName  = thinkwork-<stage>-routine-<routineId>
 *   aliasName         = "live"
 *   aliasArn          = arn:aws:states:<region>:<account>:stateMachine:<name>:<aliasName>
 *
 * The lambda-api role's IAM (see terraform/modules/app/lambda-api/main.tf
 * `RoutineStateMachineLifecycle` + `RoutineExecution`) grants every action
 * scoped to `arn:aws:states:<region>:<account>:stateMachine:thinkwork-<stage>-routine-*`.
 * Stick to that prefix or grants will silently fail.
 */

import {
  CreateStateMachineAliasCommand,
  CreateStateMachineCommand,
  PublishStateMachineVersionCommand,
  StartExecutionCommand,
  type StartExecutionCommandOutput,
  SFNClient,
  UpdateStateMachineAliasCommand,
  UpdateStateMachineCommand,
} from "@aws-sdk/client-sfn";

// ---------------------------------------------------------------------------
// Module-scope client
// ---------------------------------------------------------------------------

// Module-scope SFN client so warm Lambda invocations reuse the TCP pool.
// Tests `vi.mock('@aws-sdk/client-sfn', ...)` to swap the constructor — no
// runtime override hook needed. requestTimeout is per-call; the resolver
// chain (CreateStateMachine + PublishStateMachineVersion + CreateAlias)
// must fit in graphql-http's 30s Lambda timeout, so cap each call at 8s.
const _DEFAULT_SFN_CLIENT = new SFNClient({
  requestHandler: { requestTimeout: 8_000, connectionTimeout: 5_000 },
});

export function getSfnClient(): SFNClient {
  return _DEFAULT_SFN_CLIENT;
}

// ---------------------------------------------------------------------------
// Naming conventions
// ---------------------------------------------------------------------------

export const ROUTINE_ALIAS_NAME = "live";

/** Build the canonical state machine name for a routine. */
export function stateMachineName(stage: string, routineId: string): string {
  return `thinkwork-${stage}-routine-${routineId}`;
}

/** Build the canonical state machine ARN. */
export function stateMachineArn(
  region: string,
  accountId: string,
  stage: string,
  routineId: string,
): string {
  return `arn:aws:states:${region}:${accountId}:stateMachine:${stateMachineName(stage, routineId)}`;
}

/** Build the canonical alias ARN — the ARN routines invoke against. */
export function stateMachineAliasArn(
  region: string,
  accountId: string,
  stage: string,
  routineId: string,
): string {
  return `${stateMachineArn(region, accountId, stage, routineId)}:${ROUTINE_ALIAS_NAME}`;
}

// ---------------------------------------------------------------------------
// Resolver-time env snapshot
// ---------------------------------------------------------------------------

/**
 * Snapshot the env vars routines resolvers need at handler entry.
 * Resolvers should call this once at the top of each mutation rather
 * than re-reading process.env after `await` boundaries.
 */
export interface RoutinesEnv {
  region: string;
  accountId: string;
  stage: string;
  /** Execution role the new state machines run under. Provisioned by
   * Phase A U1's routines-stepfunctions Terraform module. */
  routinesExecutionRoleArn: string;
  /** Log group ARN for the routines runtime. Optional in tests. */
  routinesLogGroupArn: string | undefined;
}

export function snapshotRoutinesEnv(): RoutinesEnv {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const accountId =
    process.env.AWS_ACCOUNT_ID ?? process.env.AWS_DEFAULT_ACCOUNT ?? "";
  const stage = process.env.STAGE ?? "dev";
  const routinesExecutionRoleArn =
    process.env.ROUTINES_EXECUTION_ROLE_ARN ?? "";
  const routinesLogGroupArn = process.env.ROUTINES_LOG_GROUP_ARN;
  // Fail at handler entry rather than letting AWS reject `roleArn=""` deep
  // inside CreateStateMachine — that error surfaces as `InvalidArn` far
  // from the actual cause (missing terraform wiring of the env var).
  if (!accountId) {
    throw new Error(
      "Routines runtime is misconfigured: AWS_ACCOUNT_ID env var is not set",
    );
  }
  if (!routinesExecutionRoleArn) {
    throw new Error(
      "Routines runtime is misconfigured: ROUTINES_EXECUTION_ROLE_ARN env var is not set",
    );
  }
  return {
    region,
    accountId,
    stage,
    routinesExecutionRoleArn,
    routinesLogGroupArn,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for resolver convenience
// ---------------------------------------------------------------------------

export {
  CreateStateMachineCommand,
  CreateStateMachineAliasCommand,
  PublishStateMachineVersionCommand,
  StartExecutionCommand,
  UpdateStateMachineCommand,
  UpdateStateMachineAliasCommand,
  type StartExecutionCommandOutput,
  SFNClient,
};
