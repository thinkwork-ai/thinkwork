const DIRECT_MEMORY_VERBS =
  /\b(?:remember|recall|know|stored?|saved?|memor(?:y|ies|ize|ise)|tell me again)\b/i;

const USER_MEMORY_SUBJECTS =
  /\b(?:my|mine)\s+(?:dog|dogs|cat|cats|pet|pets|puppy|poodle|spouse|wife|husband|partner|child|children|kid|kids|son|daughter|parent|mom|mother|dad|father|birthday|anniversary|allerg(?:y|ies)|preference|preferences|favorite|favourite|passphrase|password hint|code ?name|codename|address|phone|email)\b/i;

const SPACE_MEMORY_SUBJECTS =
  /\b(?:our|this|the)\s+(?:space|project|team|workspace|launch|customer|client|account)\b.*\b(?:memory|remember|recall|decision|codename|code ?name|passphrase|priority|owner|deadline|status|plan)\b/i;

const MEMORY_OBJECT_NOUNS =
  /\b(?:dog|cat|pet|puppy|poodle|spouse|wife|husband|partner|child|children|kid|son|daughter|birthday|anniversary|allerg(?:y|ies)|preference|preferences|favorite|favourite|passphrase|code ?name|codename)\b/i;

const QUESTION_PREFIX =
  /^\s*(?:what|who|where|when|which|do|does|did|can|could|would|will|is|are|was|were|tell me)\b/i;

export function directMemoryGroundingQuery(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const question = input.trim().replace(/\s+/g, " ");
  if (!question || question.length > 500) return undefined;
  if (!QUESTION_PREFIX.test(question)) return undefined;

  if (DIRECT_MEMORY_VERBS.test(question)) {
    if (
      USER_MEMORY_SUBJECTS.test(question) ||
      SPACE_MEMORY_SUBJECTS.test(question) ||
      /\b(?:user|space|long[- ]term)\s+memor(?:y|ies)\b/i.test(question)
    ) {
      return question;
    }
  }

  if (
    USER_MEMORY_SUBJECTS.test(question) &&
    MEMORY_OBJECT_NOUNS.test(question)
  ) {
    return question;
  }

  if (SPACE_MEMORY_SUBJECTS.test(question)) {
    return question;
  }

  return undefined;
}
