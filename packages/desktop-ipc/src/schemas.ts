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

export const DeepLinkCallbackSchema = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export const PendingOAuthCallbackSchema = DeepLinkCallbackSchema.extend({
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
    arch: UpdateArchMetadataSchema,
    version: z.string().min(1).nullable().optional(),
    channel: z.string().min(1).optional(),
    progressPercent: z.number().min(0).max(100).optional(),
    error: UpdateErrorSchema.optional(),
  })
  .strict();

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
export type PendingOAuthCallback = z.infer<typeof PendingOAuthCallbackSchema>;
export type OAuthErrorEvent = z.infer<typeof OAuthErrorEventSchema>;
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type UpdateArchMetadata = z.infer<typeof UpdateArchMetadataSchema>;
export type UpdateState = z.infer<typeof UpdateStateSchema>;
export type ReportInstallOutcomeRequest = z.infer<
  typeof ReportInstallOutcomeRequestSchema
>;
