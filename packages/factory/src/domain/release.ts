/**
 * Release tag scheme — template-driven so the factory is not married to any
 * one project's tagging convention (THINK-287 genericize). A template is a
 * literal tag string with a single `<N>` placeholder for the monotonically
 * increasing release number, e.g. `v0.1.0-canary.<N>`. The `release` verb
 * mints the primary template plus every extra template at the same N.
 */

export interface ReleaseConfig {
  /** Primary tag template with `<N>`, e.g. "v0.1.0-canary.<N>". */
  tagTemplate: string;
  /** Extra tags minted alongside at the same N, e.g. ["desktop-v0.1.0-canary.<N>"]. */
  extraTagTemplates: string[];
  /** Optional prose appended to the cut ack (what the tags trigger). */
  note?: string;
}

/**
 * Default scheme = the thinkwork convention this code grew up with. Kept as
 * the fallback so a config without a `release` section behaves exactly as
 * before; the standalone factory's own docs tell operators to set it.
 */
export const DEFAULT_RELEASE: ReleaseConfig = {
  tagTemplate: "v0.1.0-canary.<N>",
  extraTagTemplates: ["desktop-v0.1.0-canary.<N>"],
  note: "The desktop tag deploys apps/web to dev.",
};

const N_PLACEHOLDER = "<N>";

/** Concrete tag for a release number. */
export function tagForN(template: string, n: number): string {
  return template.replaceAll(N_PLACEHOLDER, String(n));
}

/** `git tag --list` glob matching every tag the template can produce. */
export function tagGlob(template: string): string {
  return template.replaceAll(N_PLACEHOLDER, "*");
}

/** Anchored regex matching the template with `<N>` as a captured number. */
export function tagRegex(template: string): RegExp {
  const escaped = template
    .split(N_PLACEHOLDER)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(\\d+)");
  return new RegExp(`^${escaped}$`);
}

/**
 * Next release number from `git tag --list <glob> --sort=-version:refname`
 * output (newest first): newest matching tag's N + 1, or 1 when none exist.
 */
export function nextN(template: string, tagList: string): number {
  const re = tagRegex(template);
  for (const line of tagList.split("\n")) {
    const m = re.exec(line.trim());
    if (m !== null) return Number(m[1]) + 1;
  }
  return 1;
}

/**
 * Newest concrete tag in `git tag --list` output matching the template, or
 * null when none exists (deploy `<VERSION>` resolution).
 */
export function latestTag(template: string, tagList: string): string | null {
  const re = tagRegex(template);
  for (const line of tagList.split("\n")) {
    const trimmed = line.trim();
    if (re.test(trimmed)) return trimmed;
  }
  return null;
}

/** All tags minted for one release: primary first, extras after. */
export function releaseTags(release: ReleaseConfig, n: number): string[] {
  return [
    tagForN(release.tagTemplate, n),
    ...release.extraTagTemplates.map((t) => tagForN(t, n)),
  ];
}
