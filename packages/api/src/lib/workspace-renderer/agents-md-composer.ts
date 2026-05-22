export const ACTIVE_SPACE_MARKER = "<!-- RENDERED:ACTIVE_SPACE -->";

export interface ComposeAgentsMdInput {
  baseline: string;
  spaceSlug: string;
  spaceName: string;
  isDefaultSpace: boolean;
  renderedAt: Date;
  topLevelSpaceMdPath: string;
  activeSpaceMdPath: string;
  provenanceSpaceMdPath: string;
  userMdPath?: string | null;
}

export function composeAgentsMd(input: ComposeAgentsMdInput): string {
  const section = [
    ACTIVE_SPACE_MARKER,
    "",
    "## Active Space",
    "",
    `- **Name:** ${input.spaceName}`,
    `- **Slug:** ${input.spaceSlug}`,
    `- **Rendered at:** ${input.renderedAt.toISOString()}`,
    `- **Space file:** ${input.topLevelSpaceMdPath}`,
    `- **Active Space folder:** ${input.activeSpaceMdPath}`,
    `- **Provenance source:** ${input.provenanceSpaceMdPath}`,
    input.userMdPath ? `- **User file:** ${input.userMdPath}` : null,
    input.isDefaultSpace
      ? "- **Default Space:** yes; use user-scoped context as the primary long-term memory boundary."
      : "- **Default Space:** no; prefer Space-scoped context for this turn unless a tool explicitly requests user scope.",
    "",
    "Read the top-level SPACE.md before relying on Space-specific assumptions. Active Space files live under space/; the spaces/<slug>/ copy preserves authored-source provenance during the transition.",
  ].filter((line): line is string => line !== null);

  const renderedSection = `${section.join("\n")}\n`;
  if (input.baseline.includes(ACTIVE_SPACE_MARKER)) {
    return `${input.baseline.slice(0, input.baseline.indexOf(ACTIVE_SPACE_MARKER)).trimEnd()}\n\n${renderedSection}`;
  }
  return `${input.baseline.trimEnd()}\n\n${renderedSection}`;
}
