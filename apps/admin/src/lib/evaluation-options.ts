// Labels are title-case versions of the Thinkwork seed-pack category slugs
// (see seeds/eval-test-cases/*.json).
export const EVAL_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "red-team-prompt-injection", label: "Prompt Injection" },
  { id: "red-team-tool-misuse", label: "Tool Misuse" },
  { id: "red-team-data-boundary", label: "Data Boundary" },
  { id: "red-team-safety-scope", label: "Safety & Scope" },
  { id: "performance-agents", label: "Agent Performance" },
  { id: "performance-computer", label: "Computer Performance" },
  { id: "performance-skills", label: "Skill Performance" },
];

export function allEvalCategoryIds(): string[] {
  return EVAL_CATEGORIES.map((category) => category.id);
}
