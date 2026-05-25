const NAME_ANCHOR_RE = /^- \*\*Name:\*\*.*$/m;
const LEGACY_NAME_ANCHOR_RE = /Your name is \*\*[^*]+\*\*\./;

const IDENTITY_FIELD_ANCHORS = {
  creature: /^- \*\*Creature:\*\*.*$/m,
  vibe: /^- \*\*Vibe:\*\*.*$/m,
  emoji: /^- \*\*Emoji:\*\*.*$/m,
  avatar: /^- \*\*Avatar:\*\*.*$/m,
} as const;

export type AgentIdentityField = keyof typeof IDENTITY_FIELD_ANCHORS;

export function sanitizeIdentityValue(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
}

export function replaceAgentsMdName(
  existing: string,
  newName: string,
): string | null {
  const safeName = sanitizeIdentityValue(newName);
  if (NAME_ANCHOR_RE.test(existing)) {
    return existing.replace(NAME_ANCHOR_RE, () => `- **Name:** ${safeName}`);
  }
  if (LEGACY_NAME_ANCHOR_RE.test(existing)) {
    return existing.replace(
      LEGACY_NAME_ANCHOR_RE,
      () => `Your name is **${safeName}**.`,
    );
  }
  return null;
}

export function upsertAgentsMdName(existing: string, newName: string): string {
  const replaced = replaceAgentsMdName(existing, newName);
  if (replaced !== null) return replaced;

  const safeName = sanitizeIdentityValue(newName);
  const identityRange = sectionBodyRange(existing, "Identity");
  if (identityRange) {
    return (
      existing.slice(0, identityRange.start) +
      `- **Name:** ${safeName}\n` +
      existing.slice(identityRange.start)
    );
  }

  const suffix = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${suffix}\n## Identity\n\n- **Name:** ${safeName}\n`;
}

export function replaceAgentsMdIdentityField(
  existing: string,
  field: AgentIdentityField,
  value: string,
): string | null {
  const anchor = IDENTITY_FIELD_ANCHORS[field];
  if (!anchor.test(existing)) return null;
  const safeValue = sanitizeIdentityValue(value);
  return existing.replace(
    anchor,
    () => `- **${identityFieldLabel(field)}:** ${safeValue}`,
  );
}

export function identityFieldLabel(field: AgentIdentityField): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

export function isAgentIdentityField(
  field: string,
): field is AgentIdentityField {
  return Object.prototype.hasOwnProperty.call(IDENTITY_FIELD_ANCHORS, field);
}

function sectionBodyRange(
  markdown: string,
  heading: string,
): { start: number; end: number } | null {
  const pattern = new RegExp(
    `(^|\\n)## ${escapeRegex(heading)}[ \\t]*(?:\\r?\\n|$)`,
  );
  const match = pattern.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const nextHeading = markdown.slice(start).search(/\n## /);
  const end = nextHeading === -1 ? markdown.length : start + nextHeading + 1;
  return { start, end };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
