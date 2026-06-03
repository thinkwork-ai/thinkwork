/**
 * Human-readable build label shown in the sidebar brand header so it's obvious
 * which release is running (the recurring "which build am I on?" confusion).
 *
 * `VITE_APP_VERSION` is injected at build time from the release tag (web deploy
 * + desktop build). Falls back to "Spaces" when unset (e.g. local dev), so the
 * brand still reads sensibly.
 *
 * "0.1.0-canary.94" -> "canary 94"; "0.1.0-beta.3" -> "beta 3"; "1.2.3" -> "v1.2.3".
 */
export const APP_VERSION_LABEL: string = (() => {
  const raw = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim();
  if (!raw) return "Spaces";
  const prerelease = /-([A-Za-z]+)\.(\d+)$/.exec(raw);
  if (prerelease) return `${prerelease[1]} ${prerelease[2]}`;
  return `v${raw}`;
})();
