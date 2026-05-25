export type PersonalizationForm = {
  agentName: string;
  personalityTraits: string;
  communicationStyle: "formal" | "casual" | "balanced";
  preferredName: string;
  roleDescription: string;
  aboutMe: string;
  topicsOfInterest: string;
  thingsToRemember: string;
  timezone: string;
};

export const DEFAULT_PERSONALIZATION_FORM: PersonalizationForm = {
  agentName: "",
  personalityTraits: "",
  communicationStyle: "balanced",
  preferredName: "",
  roleDescription: "",
  aboutMe: "",
  topicsOfInterest: "",
  thingsToRemember: "",
  timezone: "",
};

export function parseFormFromMarkdown(
  agentsMd: string,
  user: string,
): PersonalizationForm {
  const form = { ...DEFAULT_PERSONALIZATION_FORM };

  const nameMatch = agentsMd.match(/^- \*\*Name:\*\*\s*(.+)$/m);
  if (nameMatch) form.agentName = nameMatch[1].trim();

  const personality = sectionBody(agentsMd, "Personality");
  if (personality) {
    const styleMatch = personality.match(
      /### Communication Style\n([\s\S]*?)(?=\n###|\n##|\n$|$)/,
    );
    if (styleMatch) {
      const style = styleMatch[1].trim().toLowerCase();
      if (style.includes("formal")) form.communicationStyle = "formal";
      else if (style.includes("casual")) form.communicationStyle = "casual";
      else form.communicationStyle = "balanced";
    }
    form.personalityTraits = personality
      .replace(/### Communication Style\n[\s\S]*?(?=\n###|\n##|\n$|$)/, "")
      .trim();
  }

  const prefNameMatch = user.match(/## Name\n(.+)/);
  if (prefNameMatch) form.preferredName = prefNameMatch[1].trim();

  const roleMatch = user.match(/## Role\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (roleMatch) form.roleDescription = roleMatch[1].trim();

  const aboutMatch = user.match(/## About\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (aboutMatch) form.aboutMe = aboutMatch[1].trim();

  const topicsMatch = user.match(
    /## Topics of Interest\n([\s\S]*?)(?=\n##|\n$|$)/,
  );
  if (topicsMatch) form.topicsOfInterest = topicsMatch[1].trim();

  const rememberMatch = user.match(
    /## Things to Remember\n([\s\S]*?)(?=\n##|\n$|$)/,
  );
  if (rememberMatch) form.thingsToRemember = rememberMatch[1].trim();

  const tzMatch = user.match(/## Timezone\n(.+)/);
  if (tzMatch) form.timezone = tzMatch[1].trim();

  return form;
}

export function renderAgentsMd(
  existing: string,
  form: PersonalizationForm,
): string {
  const withPersonality = replaceSection(
    existing || "# AGENTS.md\n",
    "Personality",
    `${form.personalityTraits.trim()}\n\n### Communication Style\n${form.communicationStyle}\n`,
  );
  return replaceIdentityName(withPersonality, form.agentName.trim() || "Agent");
}

export function renderUserMd(form: PersonalizationForm): string {
  const sections: string[] = [];
  sections.push("# User Context\n");
  if (form.preferredName) sections.push(`## Name\n${form.preferredName}\n`);
  if (form.roleDescription) sections.push(`## Role\n${form.roleDescription}\n`);
  if (form.aboutMe) sections.push(`## About\n${form.aboutMe}\n`);
  if (form.topicsOfInterest) {
    sections.push(`## Topics of Interest\n${form.topicsOfInterest}\n`);
  }
  if (form.thingsToRemember) {
    sections.push(`## Things to Remember\n${form.thingsToRemember}\n`);
  }
  if (form.timezone) sections.push(`## Timezone\n${form.timezone}\n`);
  return sections.join("\n");
}

function sectionBody(markdown: string, heading: string): string | null {
  const range = sectionBodyRange(markdown, heading);
  return range ? markdown.slice(range.start, range.end) : null;
}

function replaceSection(
  markdown: string,
  heading: string,
  body: string,
): string {
  const range = sectionBodyRange(markdown, heading);
  const nextBody = body.endsWith("\n") ? body : `${body}\n`;
  if (!range) {
    const suffix = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${suffix}\n## ${heading}\n\n${nextBody}`;
  }
  return markdown.slice(0, range.start) + nextBody + markdown.slice(range.end);
}

function replaceIdentityName(markdown: string, name: string): string {
  const nameLine = `- **Name:** ${name}`;
  if (/^- \*\*Name:\*\*.*$/m.test(markdown)) {
    return markdown.replace(/^- \*\*Name:\*\*.*$/m, () => nameLine);
  }

  const range = sectionBodyRange(markdown, "Identity");
  if (range) {
    return (
      markdown.slice(0, range.start) +
      `${nameLine}\n` +
      markdown.slice(range.start)
    );
  }

  return replaceSection(
    markdown,
    "Identity",
    [
      nameLine,
      "- **Creature:** _(set by your human - edit freely as you learn who you're becoming)_",
      "- **Vibe:** _(evolves as you get to know your human)_",
      "- **Emoji:** 🤖",
      "- **Avatar:** _(none yet)_",
      "",
      "This section is yours to evolve. Update the lines above as your personality takes shape.",
      "",
    ].join("\n"),
  );
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
