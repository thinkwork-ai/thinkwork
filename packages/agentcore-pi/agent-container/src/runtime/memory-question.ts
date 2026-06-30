const DIRECT_MEMORY_VERBS =
  /\b(?:remember|recall|know|stored?|saved?|memor(?:y|ies|ize|ise)|tell me again)\b/i;

const USER_MEMORY_SUBJECTS =
  /\b(?:my|mine)\s+(?:dog|dogs|cat|cats|pet|pets|puppy|poodle|spouse|wife|husband|partner|child|children|kid|kids|son|daughter|parent|mom|mother|dad|father|birthday|anniversary|allerg(?:y|ies)|preference|preferences|favorite|favourite|passphrase|password hint|code ?name|codename|address|phone|email)\b/i;

const SPACE_MEMORY_SUBJECTS =
  /\b(?:our|this|the)\s+(?:space|project|team|workspace|launch|customer|client|account)\b.*\b(?:memory|remember|recall|decision|codename|code ?name|passphrase|priority|owner|deadline|status|plan)\b/i;

const FIRST_PERSON_MEMORY_QUERY =
  /\b(?:I|me|my|mine|we|us|our|ours)\b.*\b(?:remember|recall|memor(?:y|ies)|stored?|saved?|told you|mentioned|said)\b|\b(?:remember|recall|memor(?:y|ies)|stored?|saved?|told you|mentioned|said)\b.*\b(?:I|me|my|mine|we|us|our|ours)\b/i;

const MEMORY_OBJECT_NOUNS =
  /\b(?:dog|cat|pet|puppy|poodle|spouse|wife|husband|partner|child|children|kid|son|daughter|birthday|anniversary|allerg(?:y|ies)|preference|preferences|favorite|favourite|passphrase|code ?name|codename)\b/i;

const QUESTION_PREFIX =
  /^\s*(?:what|who|where|when|which|do|does|did|can|could|would|will|is|are|was|were|tell me)\b/i;

const MEMORY_RETENTION_COMMAND =
  /\b(?:remember|memorize|memorise|store|save|record|retain|log|keep)\b[\s\S]{0,160}\b(?:user|space|long[- ]term|future|later|next thread|separate thread|memory|remember)\b|\b(?:user|space|long[- ]term)\s+memor(?:y|ies)\b[\s\S]{0,160}\b(?:remember|memorize|memorise|store|save|record|retain|log|keep|future|later|next thread|separate thread)\b/i;

function normalizedShortMessage(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const message = input.trim().replace(/\s+/g, " ");
  if (!message || message.length > 500) return undefined;
  return message;
}

export function directMemoryGroundingQuery(input: unknown): string | undefined {
  const question = normalizedShortMessage(input);
  if (!question || question.length > 500) return undefined;
  if (!QUESTION_PREFIX.test(question)) return undefined;

  if (DIRECT_MEMORY_VERBS.test(question)) {
    if (
      USER_MEMORY_SUBJECTS.test(question) ||
      SPACE_MEMORY_SUBJECTS.test(question) ||
      FIRST_PERSON_MEMORY_QUERY.test(question) ||
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

export function explicitMemoryTurn(input: unknown): boolean {
  const message = normalizedShortMessage(input);
  if (!message) return false;

  if (directMemoryGroundingQuery(message)) return true;

  if (MEMORY_RETENTION_COMMAND.test(message)) return true;

  return (
    /\b(?:please\s+)?remember\s+this\b/i.test(message) &&
    /\b(?:future|later|next thread|separate thread|user memory|space memory|long[- ]term memory)\b/i.test(
      message,
    )
  );
}
