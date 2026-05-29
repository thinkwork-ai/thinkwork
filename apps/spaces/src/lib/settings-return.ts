// Remembers the app route the user was on when they opened Settings, so
// "Back to app" can return there. Survives a reload within the tab via
// sessionStorage; falls back to the home route on a cold deep-link.

const KEY = "thinkwork.settings.returnTo";

export function rememberSettingsReturnTo(path: string): void {
  if (path.startsWith("/settings")) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // sessionStorage unavailable (private mode / SSR) — fall back to "/".
  }
}

export function getSettingsReturnTo(): string {
  try {
    return sessionStorage.getItem(KEY) || "/";
  } catch {
    return "/";
  }
}
