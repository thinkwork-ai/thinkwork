export type SendMessageGoalModeAction =
  | "start"
  | "resume"
  | "pause"
  | "cancel"
  | "clear";

export interface SendMessageGoalMode {
  enabled: true;
  action: SendMessageGoalModeAction;
  objective?: string;
  goalRunId?: string;
}

export interface SendMessageOptions {
  /** Optional attribution. Defaults to `"user"` if not provided. */
  senderType?: string;
  /** Optional user/agent id stamped on the message row. */
  senderId?: string;
  /** Optional message metadata. Serialized to GraphQL AWSJSON. */
  metadata?: Record<string, unknown>;
  /** Optional model override for the agent turn. */
  modelId?: string;
  /** Optional agent dispatch request flag. */
  agentRequested?: boolean;
  /** Optional server dispatch mode enum value. */
  dispatchMode?: string;
  /** Optional Goal mode intent. Serialized under metadata.goalMode. */
  goalMode?: SendMessageGoalMode;
}

export function buildSendMessageMutationVariables(
  threadId: string,
  content: string,
  opts?: SendMessageOptions,
) {
  const metadata = opts?.goalMode
    ? { ...(opts.metadata ?? {}), goalMode: opts.goalMode }
    : opts?.metadata;

  return {
    input: {
      threadId,
      role: "USER",
      content,
      senderType: opts?.senderType ?? "user",
      ...(opts?.senderId ? { senderId: opts.senderId } : {}),
      ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
      ...(opts?.modelId ? { modelId: opts.modelId } : {}),
      ...(opts?.agentRequested !== undefined
        ? { agentRequested: opts.agentRequested }
        : {}),
      ...(opts?.dispatchMode ? { dispatchMode: opts.dispatchMode } : {}),
    },
  };
}
