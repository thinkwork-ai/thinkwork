import { z } from "zod";

export const EmptyRequestSchema = z.undefined();
export const VoidResponseSchema = z.undefined();

export const TokenStorageSnapshotSchema = z
  .object({
    items: z.record(z.string(), z.string()),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const SessionTokensSchema = TokenStorageSnapshotSchema;

export const GetSessionTokensRequestSchema = EmptyRequestSchema;
export const GetSessionTokensResponseSchema = SessionTokensSchema.nullable();

export const SetTokenStorageItemRequestSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
  })
  .strict();
export const SetTokenStorageItemResponseSchema = VoidResponseSchema;

export const RemoveTokenStorageItemRequestSchema = z
  .object({
    key: z.string().min(1),
  })
  .strict();
export const RemoveTokenStorageItemResponseSchema = VoidResponseSchema;

export const ClearTokenStorageRequestSchema = EmptyRequestSchema;
export const ClearTokenStorageResponseSchema = VoidResponseSchema;
export const TokensChangedEventSchema = TokenStorageSnapshotSchema;

export const StartOAuthRequestSchema = z
  .object({
    next: z
      .string()
      .min(1)
      .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
        message: "next must be an internal absolute path",
      })
      .optional(),
  })
  .strict()
  .optional();
export const StartOAuthResponseSchema = z
  .object({
    url: z.string().url(),
    state: z.string().min(1),
  })
  .strict();

export const SignOutRequestSchema = EmptyRequestSchema;
export const SignOutResponseSchema = z
  .object({
    ok: z.literal(true),
    revokeFailed: z.boolean(),
  })
  .strict();
export const SignedOutEventSchema = SignOutResponseSchema;

export const OAuthSuccessCallbackSchema = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export const OAuthFailureCallbackSchema = z
  .object({
    error: z.string().min(1),
    errorDescription: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
  })
  .strict();

export const DeepLinkCallbackSchema = z.union([
  OAuthSuccessCallbackSchema,
  OAuthFailureCallbackSchema,
]);

export const PendingOAuthCallbackSchema = OAuthSuccessCallbackSchema.extend({
  next: z.string().min(1).optional(),
}).strict();

export const ConsumePendingOAuthRequestSchema = EmptyRequestSchema;
export const ConsumePendingOAuthResponseSchema =
  PendingOAuthCallbackSchema.nullable();
export const DeepLinkEventSchema = DeepLinkCallbackSchema;
export const OAuthErrorEventSchema = z
  .object({
    message: z.string().min(1),
  })
  .strict();

export const DesktopConfigSchema = z
  .object({
    stage: z.string().min(1),
    configured: z.boolean(),
    missing: z.array(z.string().min(1)),
    oauthRedirectUri: z.string().min(1),
    endpoints: z
      .object({
        apiUrl: z.string().nullable(),
        graphqlHttpUrl: z.string().nullable(),
        graphqlUrl: z.string().nullable(),
        graphqlWsUrl: z.string().nullable(),
        cognitoDomain: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const GetDesktopConfigRequestSchema = EmptyRequestSchema;
export const GetDesktopConfigResponseSchema = DesktopConfigSchema;

export const UpdateStatusSchema = z.enum([
  "disabled",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "up-to-date",
  "error",
]);

export const UpdateArchMetadataSchema = z
  .object({
    hostArch: z.string().min(1),
    appArch: z.string().min(1),
    runningUnderArm64Translation: z.boolean(),
  })
  .strict();

export const UpdateErrorSchema = z
  .object({
    message: z.string().min(1),
    canRetry: z.boolean(),
  })
  .strict();

export const UpdateStateSchema = z
  .object({
    status: UpdateStatusSchema,
    currentVersion: z.string().min(1),
    availableVersion: z.string().min(1).nullable(),
    downloadedVersion: z.string().min(1).nullable(),
    downloadPercent: z.number().min(0).max(100).nullable(),
    hostArch: z.string().min(1),
    appArch: z.string().min(1),
    runningUnderArm64Translation: z.boolean(),
    checkedAt: z.string().min(1).nullable(),
    message: z.string().min(1).nullable(),
    errorContext: z.enum(["check", "download", "install"]).nullable(),
    canRetry: z.boolean(),
    channel: z.string().min(1),
  })
  .strict();

export const UpdateDownloadCompletedEventSchema = z
  .object({
    type: z.literal("update.download_completed"),
    version: z.string().min(1),
    channel: z.string().min(1),
    fromVersion: z.string().min(1),
  })
  .strict();

export const UpdateInstallCompletedEventSchema = z
  .object({
    type: z.literal("update.install_completed"),
    version: z.string().min(1),
    fromVersion: z.string().min(1),
  })
  .strict();

export const UpdateInstallFailedOrSkippedEventSchema = z
  .object({
    type: z.literal("update.install_failed_or_skipped"),
    version: z.string().min(1),
    fromVersion: z.string().min(1),
    attemptedVersion: z.string().min(1),
  })
  .strict();

export const UpdateTelemetryEventSchema = z.discriminatedUnion("type", [
  UpdateDownloadCompletedEventSchema,
  UpdateInstallCompletedEventSchema,
  UpdateInstallFailedOrSkippedEventSchema,
]);

export const GetUpdateStateRequestSchema = EmptyRequestSchema;
export const GetUpdateStateResponseSchema = UpdateStateSchema;
export const UpdateStateEventSchema = UpdateStateSchema;

export const CheckForUpdatesRequestSchema = EmptyRequestSchema;
export const CheckForUpdatesResponseSchema = VoidResponseSchema;

export const DownloadUpdateRequestSchema = EmptyRequestSchema;
export const DownloadUpdateResponseSchema = VoidResponseSchema;

export const InstallUpdateRequestSchema = EmptyRequestSchema;
export const InstallUpdateResponseSchema = VoidResponseSchema;

export const ReportInstallOutcomeRequestSchema = z
  .object({
    version: z.string().min(1),
    outcome: z.enum(["installed", "failed", "skipped"]),
    error: z.string().min(1).optional(),
  })
  .strict();
export const ReportInstallOutcomeResponseSchema = VoidResponseSchema;

export const PiSidecarStatusSchema = z.enum([
  "unavailable",
  "starting",
  "healthy",
  "restarting",
  "stopping",
  "stopped",
  "crashed",
  "error",
]);

export const PiSidecarErrorSchema = z
  .object({
    message: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .strict();

export const PiSidecarStateSchema = z
  .object({
    status: PiSidecarStatusSchema,
    pid: z.number().int().positive().nullable(),
    version: z.string().min(1).nullable(),
    restartCount: z.number().int().nonnegative(),
    startedAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1),
    lastExitCode: z.number().int().nullable(),
    lastError: PiSidecarErrorSchema.nullable(),
  })
  .strict();

export const PiTurnAttachmentSchema = z
  .object({
    attachmentId: z.string().min(1),
    s3Key: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const PiStartTurnRequestSchema = z
  .object({
    agentId: z.string().min(1),
    threadId: z.string().min(1),
    messageId: z.string().min(1).optional(),
    userMessage: z.string().min(1),
    messageAttachments: z.array(PiTurnAttachmentSchema).optional(),
  })
  .strict();

export const PiPrewarmWorkspaceRequestSchema = z
  .object({
    agentId: z.string().min(1),
    spaceId: z.string().min(1),
  })
  .strict();

export const PiPrewarmWorkspaceResponseSchema = z
  .object({
    accepted: z.boolean(),
    requestId: z.string().min(1),
    skippedReason: z.string().min(1).optional(),
  })
  .strict();

export const PiStartTurnResponseSchema = z
  .object({
    accepted: z.literal(true),
    requestId: z.string().min(1),
  })
  .strict();

export const PiCancelTurnRequestSchema = z
  .object({
    requestId: z.string().min(1),
  })
  .strict();

export const PiCancelTurnResponseSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const PiStartEvalRunRequestSchema = z
  .object({
    tenantId: z.string().min(1),
    categories: z.array(z.string().min(1)).optional(),
    testCaseIds: z.array(z.string().min(1)).optional(),
    model: z.string().min(1).nullable().optional(),
    spaceId: z.string().min(1).nullable().optional(),
    parallelThreads: z.number().int().min(1).max(8).optional(),
  })
  .strict();

export const PiStartEvalRunResponseSchema = z
  .object({
    accepted: z.literal(true),
    requestId: z.string().min(1),
    runId: z.string().min(1),
    totalTests: z.number().int().nonnegative(),
  })
  .strict();

export const PiCancelEvalRunRequestSchema = z
  .object({
    requestId: z.string().min(1),
  })
  .strict();

export const PiCancelEvalRunResponseSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export const GetPiStatusRequestSchema = EmptyRequestSchema;
export const GetPiStatusResponseSchema = PiSidecarStateSchema;
export const PiStatusEventSchema = PiSidecarStateSchema;
export const PiDiagnosticEventSchema = z
  .object({
    level: z.enum(["info", "warn", "error"]),
    message: z.string().min(1),
    emittedAt: z.string().min(1),
    source: z.enum(["main", "sidecar"]),
    requestId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
    threadTurnId: z.string().min(1).nullable(),
  })
  .strict();

// ---- Thread notifications ----

// Renderer → main: raise a native notification for a thread. The main process
// coalesces per threadId so repeated raises for one thread replace rather
// than stack.
export const RaiseThreadNotificationRequestSchema = z
  .object({
    threadId: z.string().min(1),
    title: z.string(),
    body: z.string(),
    count: z.number().int().positive().optional(),
  })
  .strict();
export const RaiseThreadNotificationResponseSchema = VoidResponseSchema;

// Main → renderer: a notification was clicked; navigate to this thread.
export const OpenThreadEventSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();

// Main → renderer: app window focus state (drives the "already viewing"
// suppression gate).
export const WindowFocusEventSchema = z
  .object({
    focused: z.boolean(),
  })
  .strict();

// ---- Local Pi workspace inspector (read-only) ----

// A node in the rendered cache tree. Recursive: directories carry children.
// `path` is the POSIX-style path relative to the cache root; `truncated` marks
// a directory whose contents were cut off by the walk's depth/node caps. The
// model keeps `name`/`path` separate so later human-friendly labeling can
// derive display text without losing the raw segment.
export interface WorkspaceTreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
}

export const WorkspaceTreeNodeSchema: z.ZodType<WorkspaceTreeNode> = z.lazy(
  () =>
    z
      .object({
        name: z.string(),
        path: z.string(),
        kind: z.enum(["file", "dir"]),
        children: z.array(WorkspaceTreeNodeSchema).optional(),
        truncated: z.boolean().optional(),
      })
      .strict(),
);

export const ReadWorkspaceTreeRequestSchema = EmptyRequestSchema;
// Discriminated on `status` so the renderer never collapses "nothing synced
// yet" (empty) into a real read failure (error).
export const ReadWorkspaceTreeResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      tree: z.array(WorkspaceTreeNodeSchema),
      truncated: z.boolean(),
    })
    .strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("error"), code: z.string() }).strict(),
]);

export const ReadWorkspaceFileRequestSchema = z
  .object({ path: z.string().min(1) })
  .strict();
// `ok.language` is a Shiki bundled-language id (or "text"); the main process
// maps it from the file extension with a plaintext fallback so the renderer
// never feeds Shiki an unmapped language.
export const ReadWorkspaceFileResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ok"),
      content: z.string(),
      language: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("too-large"),
      size: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ status: z.literal("binary") }).strict(),
  z.object({ status: z.literal("vanished") }).strict(),
  z.object({ status: z.literal("error"), code: z.string() }).strict(),
]);

export const ChannelSchemas = {
  getSessionTokens: {
    request: GetSessionTokensRequestSchema,
    response: GetSessionTokensResponseSchema,
  },
  setTokenStorageItem: {
    request: SetTokenStorageItemRequestSchema,
    response: SetTokenStorageItemResponseSchema,
  },
  removeTokenStorageItem: {
    request: RemoveTokenStorageItemRequestSchema,
    response: RemoveTokenStorageItemResponseSchema,
  },
  clearTokenStorage: {
    request: ClearTokenStorageRequestSchema,
    response: ClearTokenStorageResponseSchema,
  },
  startOAuth: {
    request: StartOAuthRequestSchema,
    response: StartOAuthResponseSchema,
  },
  signOut: {
    request: SignOutRequestSchema,
    response: SignOutResponseSchema,
  },
  consumePendingOAuth: {
    request: ConsumePendingOAuthRequestSchema,
    response: ConsumePendingOAuthResponseSchema,
  },
  getDesktopConfig: {
    request: GetDesktopConfigRequestSchema,
    response: GetDesktopConfigResponseSchema,
  },
  getUpdateState: {
    request: GetUpdateStateRequestSchema,
    response: GetUpdateStateResponseSchema,
  },
  checkForUpdates: {
    request: CheckForUpdatesRequestSchema,
    response: CheckForUpdatesResponseSchema,
  },
  downloadUpdate: {
    request: DownloadUpdateRequestSchema,
    response: DownloadUpdateResponseSchema,
  },
  installUpdate: {
    request: InstallUpdateRequestSchema,
    response: InstallUpdateResponseSchema,
  },
  reportInstallOutcome: {
    request: ReportInstallOutcomeRequestSchema,
    response: ReportInstallOutcomeResponseSchema,
  },
  getPiStatus: {
    request: GetPiStatusRequestSchema,
    response: GetPiStatusResponseSchema,
  },
  prewarmPiWorkspace: {
    request: PiPrewarmWorkspaceRequestSchema,
    response: PiPrewarmWorkspaceResponseSchema,
  },
  startPiTurn: {
    request: PiStartTurnRequestSchema,
    response: PiStartTurnResponseSchema,
  },
  cancelPiTurn: {
    request: PiCancelTurnRequestSchema,
    response: PiCancelTurnResponseSchema,
  },
  startPiEvalRun: {
    request: PiStartEvalRunRequestSchema,
    response: PiStartEvalRunResponseSchema,
  },
  cancelPiEvalRun: {
    request: PiCancelEvalRunRequestSchema,
    response: PiCancelEvalRunResponseSchema,
  },
  raiseThreadNotification: {
    request: RaiseThreadNotificationRequestSchema,
    response: RaiseThreadNotificationResponseSchema,
  },
  readWorkspaceTree: {
    request: ReadWorkspaceTreeRequestSchema,
    response: ReadWorkspaceTreeResponseSchema,
  },
  readWorkspaceFile: {
    request: ReadWorkspaceFileRequestSchema,
    response: ReadWorkspaceFileResponseSchema,
  },
} as const;

export type TokenStorageSnapshot = z.infer<typeof TokenStorageSnapshotSchema>;
export type SessionTokens = TokenStorageSnapshot;
export type SetTokenStorageItemRequest = z.infer<
  typeof SetTokenStorageItemRequestSchema
>;
export type RemoveTokenStorageItemRequest = z.infer<
  typeof RemoveTokenStorageItemRequestSchema
>;
export type StartOAuthRequest = z.infer<typeof StartOAuthRequestSchema>;
export type StartOAuthResponse = z.infer<typeof StartOAuthResponseSchema>;
export type SignOutResponse = z.infer<typeof SignOutResponseSchema>;
export type DeepLinkCallback = z.infer<typeof DeepLinkCallbackSchema>;
export type OAuthSuccessCallback = z.infer<typeof OAuthSuccessCallbackSchema>;
export type OAuthFailureCallback = z.infer<typeof OAuthFailureCallbackSchema>;
export type PendingOAuthCallback = z.infer<typeof PendingOAuthCallbackSchema>;
export type OAuthErrorEvent = z.infer<typeof OAuthErrorEventSchema>;
export type DesktopConfig = z.infer<typeof DesktopConfigSchema>;
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type UpdateArchMetadata = z.infer<typeof UpdateArchMetadataSchema>;
export type UpdateState = z.infer<typeof UpdateStateSchema>;
export type UpdateTelemetryEvent = z.infer<typeof UpdateTelemetryEventSchema>;
export type ReportInstallOutcomeRequest = z.infer<
  typeof ReportInstallOutcomeRequestSchema
>;
export type PiSidecarStatus = z.infer<typeof PiSidecarStatusSchema>;
export type PiSidecarState = z.infer<typeof PiSidecarStateSchema>;
export type PiDiagnosticEvent = z.infer<typeof PiDiagnosticEventSchema>;
export type PiPrewarmWorkspaceRequest = z.infer<
  typeof PiPrewarmWorkspaceRequestSchema
>;
export type PiPrewarmWorkspaceResponse = z.infer<
  typeof PiPrewarmWorkspaceResponseSchema
>;
export type PiStartTurnRequest = z.infer<typeof PiStartTurnRequestSchema>;
export type PiStartTurnResponse = z.infer<typeof PiStartTurnResponseSchema>;
export type PiCancelTurnRequest = z.infer<typeof PiCancelTurnRequestSchema>;
export type PiCancelTurnResponse = z.infer<typeof PiCancelTurnResponseSchema>;
export type PiStartEvalRunRequest = z.infer<typeof PiStartEvalRunRequestSchema>;
export type PiStartEvalRunResponse = z.infer<
  typeof PiStartEvalRunResponseSchema
>;
export type PiCancelEvalRunRequest = z.infer<
  typeof PiCancelEvalRunRequestSchema
>;
export type PiCancelEvalRunResponse = z.infer<
  typeof PiCancelEvalRunResponseSchema
>;
export type RaiseThreadNotificationRequest = z.infer<
  typeof RaiseThreadNotificationRequestSchema
>;
export type OpenThreadEvent = z.infer<typeof OpenThreadEventSchema>;
export type WindowFocusEvent = z.infer<typeof WindowFocusEventSchema>;
export type ReadWorkspaceFileRequest = z.infer<
  typeof ReadWorkspaceFileRequestSchema
>;
export type ReadWorkspaceTreeResponse = z.infer<
  typeof ReadWorkspaceTreeResponseSchema
>;
export type ReadWorkspaceFileResponse = z.infer<
  typeof ReadWorkspaceFileResponseSchema
>;
