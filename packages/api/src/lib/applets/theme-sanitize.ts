/**
 * Strip CSS constructs that can phone home or inject behavior from a tenant
 * applet theme before it is injected into the applet iframe. The spaces App
 * Style UI validates this client-side, but `updateTenantSettings` accepts
 * service-secret callers that bypass the UI, so the server read path is the
 * real gate (this also sanitizes any CSS persisted before this guard existed).
 *
 * Drops `@import` at-rules and any declaration whose value carries `url(`,
 * `expression(`, or `javascript:`. Pure + leaf so it is unit-testable without
 * loading the resolver/db graph.
 */
export function sanitizeAppletThemeCss(css: string): string {
  return css
    .replace(/@import[^;]*;/gi, "")
    .replace(
      /[^;{}]*:[^;{}]*(?:url\s*\(|expression\s*\(|javascript:)[^;{}]*;?/gi,
      "",
    );
}
