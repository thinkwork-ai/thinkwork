import type { PreparedDesktopPiRuntimeSession } from "@thinkwork/pi-runtime-core";

type BedrockAdapterSession = Pick<
  PreparedDesktopPiRuntimeSession,
  "invocation" | "sidecarCredentials"
>;

export interface BedrockRuntimeAdapter {
  modelId: string | null;
  provider: "amazon-bedrock";
  credentialsMode: "ambient" | "temporary" | "server-brokered";
}

export function createBedrockRuntimeAdapter(
  session: BedrockAdapterSession,
): BedrockRuntimeAdapter {
  const aws = readRecord(session.sidecarCredentials)?.aws;
  const credentialsMode =
    readRecord(aws)?.mode === "server-brokered"
      ? "server-brokered"
      : readRecord(aws)?.accessKeyId
        ? "temporary"
        : "ambient";

  return {
    modelId:
      typeof session.invocation.model === "string"
        ? session.invocation.model
        : null,
    provider: "amazon-bedrock",
    credentialsMode,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
