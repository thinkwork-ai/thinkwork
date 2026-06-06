/**
 * Recognize a `skills` meta-tool invocation and pull the skill slug out
 * of its `input_preview`. Returns null when the row is any other tool.
 *
 * The Strands runtime's AgentSkills plugin (and the future in-house
 * Skill meta-tool) registers a single tool whose argument carries the
 * chosen skill slug. Rendering the row label as bare "skills" hides
 * which skill actually fired — operators need to see e.g.
 * "Skill: finance-statement-analysis" so they can tell at a glance
 * whether the Anthropic finance lift was used on a turn.
 *
 * Lives in its own module so the pure parsing can be unit-tested
 * without pulling React into the test bundle.
 */

const SKILL_TOOL_NAMES = new Set(["skills", "Skill"]);

export function extractSkillName(
  toolName: string | undefined,
  toolInput: string | undefined,
): string | null {
  if (!toolName || !SKILL_TOOL_NAMES.has(toolName)) return null;
  if (!toolInput) return null;
  try {
    const parsed = JSON.parse(toolInput);
    const candidate =
      typeof parsed?.skill_name === "string"
        ? parsed.skill_name
        : typeof parsed?.name === "string"
          ? parsed.name
          : null;
    return candidate && candidate.trim() ? candidate.trim() : null;
  } catch {
    return null;
  }
}
