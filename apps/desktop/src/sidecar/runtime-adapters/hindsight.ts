import type { PreparedDesktopPiRuntimeSession } from "@thinkwork/pi-runtime-core";

type HindsightAdapterSession = Pick<
  PreparedDesktopPiRuntimeSession,
  "invocation"
>;

export interface HindsightRuntimeAdapter {
  enabled: boolean;
  endpoint: string | null;
}

export function createHindsightRuntimeAdapter(
  session: HindsightAdapterSession,
): HindsightRuntimeAdapter {
  const endpoint =
    typeof session.invocation.hindsight_endpoint === "string"
      ? session.invocation.hindsight_endpoint
      : null;
  return {
    enabled: session.invocation.use_memory !== false && Boolean(endpoint),
    endpoint,
  };
}
