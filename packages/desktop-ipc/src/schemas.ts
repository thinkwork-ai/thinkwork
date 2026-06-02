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
  raiseThreadNotification: {
    request: RaiseThreadNotificationRequestSchema,
    response: RaiseThreadNotificationResponseSchema,
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
export type RaiseThreadNotificationRequest = z.infer<
  typeof RaiseThreadNotificationRequestSchema
>;
export type OpenThreadEvent = z.infer<typeof OpenThreadEventSchema>;
export type WindowFocusEvent = z.infer<typeof WindowFocusEventSchema>;
