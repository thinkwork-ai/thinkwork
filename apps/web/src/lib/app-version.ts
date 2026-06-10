/**
 * Human-readable build label shown in the sidebar brand header so it's obvious
 * which release is running (the recurring "which build am I on?" confusion).
 *
 * `__THINKWORK_WEB_VERSION__` is injected at build time from the release tag
 * (web deploy + desktop build). Local dev falls back to the package version
 * with a `-dev` suffix so Settings can always show a useful build label.
 *
 * "0.1.0-canary.94" -> "canary 94"; "0.1.0-beta.3" -> "beta 3"; "1.2.3" -> "v1.2.3".
 */
export const APP_VERSION_LABEL: string = (() => {
  const raw =
    typeof __THINKWORK_WEB_VERSION__ === "string"
      ? __THINKWORK_WEB_VERSION__.trim()
      : "";
  if (!raw) return "unknown";
  const prerelease = /-([A-Za-z]+)\.(\d+)$/.exec(raw);
  if (prerelease) return `${prerelease[1]} ${prerelease[2]}`;
  return `v${raw}`;
})();

declare const __THINKWORK_WEB_VERSION__: string;
