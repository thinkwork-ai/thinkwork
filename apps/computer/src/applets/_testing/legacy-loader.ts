/**
 * Legacy same-origin applet module loader (plan-012 U11.5).
 *
 * Gated behind `import.meta.env.VITE_APPLET_LEGACY_LOADER === "true"`
 * for emergency rollback only. Production `AppletMount` defaults to
 * the iframe substrate via `IframeAppletController`. After Phase 2
 * stabilizes for ≥1 week, a follow-up cleanup PR deletes this file
 * along with `apps/computer/src/applets/host-registry.ts`,
 * `apps/computer/src/applets/transform/`, and the `host-applet-api`
 * in-process state proxy.
 *
 * The exported loader is the same shape as the original
 * `defaultAppletModuleLoader` so the rollback flag flips back to the
 * original behavior without other code changes.
 */

import type { AppletModule, AppletModuleLoader } from "../mount";

export const defaultAppletModuleLoader: AppletModuleLoader = (moduleUrl) =>
	import(/* @vite-ignore */ moduleUrl) as Promise<AppletModule>;

/**
 * Read the rollback flag at module-evaluation time. Vite substitutes
 * `import.meta.env.VITE_APPLET_LEGACY_LOADER` at build time per stage.
 */
export function isLegacyLoaderEnabled(): boolean {
	return import.meta.env.VITE_APPLET_LEGACY_LOADER === "true";
}
