/**
 * Classification for QR payloads scanned during environment setup. The web
 * "Set up mobile" card encodes a thinkwork://deployment-profile link; users
 * may also scan a QR that simply encodes their environment's web URL.
 */
export type EnvironmentQrPayload =
  | { kind: "profile-link"; link: string }
  | { kind: "url"; url: string }
  | { kind: "invalid" };

export function parseEnvironmentQrPayload(
  data: string | null | undefined,
): EnvironmentQrPayload {
  const trimmed = (data ?? "").trim();
  if (!trimmed) return { kind: "invalid" };
  if (trimmed.startsWith("thinkwork://deployment-profile")) {
    return { kind: "profile-link", link: trimmed };
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { kind: "url", url: trimmed };
  }
  // Bare hosts (mcpherson.thinkwork.ai) are plausible QR contents too.
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(trimmed)) {
    return { kind: "url", url: trimmed };
  }
  return { kind: "invalid" };
}
