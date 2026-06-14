import { DESKTOP_APP_ORIGIN } from "./protocol.js";

const THINKWORK_HTTPS_ORIGIN_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*thinkwork\.ai$/i;
const THINKWORK_GITHUB_ORG_PATTERN =
  /^https:\/\/github\.com\/thinkwork-ai(?:\/|$)/i;
const AUTHKIT_HTTPS_ORIGIN_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*authkit\.app$/i;

export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const origin = parsed.origin;
  return (
    THINKWORK_HTTPS_ORIGIN_PATTERN.test(origin) ||
    AUTHKIT_HTTPS_ORIGIN_PATTERN.test(origin) ||
    THINKWORK_GITHUB_ORG_PATTERN.test(parsed.href)
  );
}

export function isDesktopAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const desktopOrigin = new URL(DESKTOP_APP_ORIGIN);
    return (
      parsed.protocol === desktopOrigin.protocol &&
      parsed.hostname === desktopOrigin.hostname
    );
  } catch {
    return false;
  }
}
