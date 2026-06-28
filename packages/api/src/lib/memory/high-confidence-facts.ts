import { createHash } from "node:crypto";
import {
  classifyMemoryCandidateSafety,
  type MemoryCandidateRejectReason,
} from "../requester-memory/safety.js";

export type HighConfidenceFactScope = "user" | "space";

export type HighConfidenceFactKind =
  | "allergy"
  | "family"
  | "pet"
  | "preference"
  | "space_context";

export type HighConfidenceFactMessage = {
  role?: string;
  content?: string;
  timestamp?: string;
};

export type ExtractedHighConfidenceFact = {
  id: string;
  scope: HighConfidenceFactScope;
  kind: HighConfidenceFactKind;
  text: string;
  sourceText: string;
  sourceMessageIndex: number;
  timestamp?: string;
  confidence: "high";
};

export type RejectedHighConfidenceFactCandidate = {
  reason: MemoryCandidateRejectReason;
  sourceText: string;
  sourceMessageIndex: number;
};

export type ExtractHighConfidenceFactsResult = {
  facts: ExtractedHighConfidenceFact[];
  rejected: RejectedHighConfidenceFactCandidate[];
};

type Sentence = {
  text: string;
  messageIndex: number;
  timestamp?: string;
};

const PET_WORDS = "(?:dog|puppy|cat|kitten|bird|parrot|rabbit|hamster|horse)";
const PET_CONTEXT = new RegExp(`\\b(?:new\\s+)?${PET_WORDS}\\b`, "i");
const PRONOUN_PET_NAME =
  /\b(?:her|his|their)\s+name\s+is\s+([A-Z][A-Za-z'-]{1,40})\b/i;
const NAMED_PET = new RegExp(
  `\\b(?:my|our)\\s+((?:new\\s+)?${PET_WORDS})\\b[^.?!]{0,80}?\\b(?:is\\s+named|name\\s+is|called|named)\\s+([A-Z][A-Za-z'-]{1,40})\\b`,
  "i",
);
const GOT_PET = new RegExp(
  `\\b(?:we|i)\\s+got\\s+(?:a|an)\\s+((?:new\\s+)?${PET_WORDS})\\b`,
  "i",
);
const BREED =
  /\b(?:she|he|they|it)(?:'s| is)\s+(?:a|an)\s+([A-Za-z][A-Za-z -]{1,40})\b/i;
const FAMILY_NAME =
  /\bmy\s+(wife|husband|partner|son|daughter|mother|father|brother|sister|child|kid)(?:'s)?\s+(?:name\s+is|is\s+named|is)\s+([A-Z][A-Za-z'-]{1,40})\b/i;
const ALLERGY =
  /\b(?:i\s+am|i'm)\s+allergic\s+to\s+([A-Za-z0-9 ,/&-]{2,120})\b/i;
const PREFERENCE = /\b(?:i\s+prefer|my\s+preference\s+is)\s+(.{3,160})$/i;
const SPACE_CONTEXT =
  /\b(?:the|our)\s+((?:project|workspace|space|team|client|customer|launch|release|service|repository|repo|environment|deployment|deadline|codename)[A-Za-z0-9 ,/&()'-]{0,80}?)\s+(is|are|uses|runs on|depends on)\s+(.{2,160})$/i;
const SPACE_CODENAME =
  /\b(?:the\s+)?(?:launch|release|project|space)?\s*codename\s+is\s+([A-Z][A-Za-z0-9 -]{2,80})\b/i;

export function extractHighConfidenceFacts(input: {
  messages: HighConfidenceFactMessage[];
  spaceId?: string | null;
}): ExtractHighConfidenceFactsResult {
  const sentences = splitUserSentences(input.messages);
  const facts: ExtractedHighConfidenceFact[] = [];
  const rejected: RejectedHighConfidenceFactCandidate[] = [];

  for (const sentence of sentences) {
    const safety = classifyMemoryCandidateSafety(sentence.text);
    if (!safety.safe) {
      rejected.push({
        reason: safety.reason,
        sourceText: sentence.text,
        sourceMessageIndex: sentence.messageIndex,
      });
      continue;
    }

    const previous = previousSentenceInSameMessage(sentences, sentence);
    const userFact = extractUserFact(sentence, previous);
    if (userFact) {
      facts.push(makeFact("user", userFact.kind, userFact.text, sentence));
    }

    if (input.spaceId) {
      const spaceFact = extractSpaceFact(sentence);
      if (spaceFact) {
        facts.push(makeFact("space", "space_context", spaceFact, sentence));
      }
    }
  }

  return {
    facts: dedupeFacts(facts),
    rejected,
  };
}

function extractUserFact(
  sentence: Sentence,
  previous: Sentence | null,
): { kind: HighConfidenceFactKind; text: string } | null {
  const namedPet = NAMED_PET.exec(sentence.text);
  if (namedPet) {
    const pet = petNoun(namedPet[1]);
    const name = cleanName(namedPet[2]);
    return { kind: "pet", text: `User has a ${pet} named ${name}.` };
  }

  const pronounPetName = PRONOUN_PET_NAME.exec(sentence.text);
  if (pronounPetName && previous && PET_CONTEXT.test(previous.text)) {
    const gotPet = GOT_PET.exec(previous.text);
    const breed = BREED.exec(sentence.text);
    const animal = breed ? cleanNoun(breed[1]) : petNoun(gotPet?.[1] || "pet");
    const name = cleanName(pronounPetName[1]);
    return { kind: "pet", text: `User has a ${animal} named ${name}.` };
  }

  const family = FAMILY_NAME.exec(sentence.text);
  if (family) {
    return {
      kind: "family",
      text: `User's ${family[1].toLowerCase()} is named ${cleanName(family[2])}.`,
    };
  }

  const allergy = ALLERGY.exec(sentence.text);
  if (allergy) {
    return {
      kind: "allergy",
      text: `User is allergic to ${cleanPhrase(allergy[1])}.`,
    };
  }

  const preference = PREFERENCE.exec(sentence.text);
  if (preference) {
    return {
      kind: "preference",
      text: `User prefers ${cleanPhrase(preference[1])}.`,
    };
  }

  return null;
}

function extractSpaceFact(sentence: Sentence): string | null {
  if (
    /\b(?:my|i'm|i am|my wife|my husband|my dog|my cat)\b/i.test(sentence.text)
  ) {
    return null;
  }
  const codename = SPACE_CODENAME.exec(sentence.text);
  if (codename) {
    return `The launch codename is ${cleanPhrase(codename[1])}.`;
  }
  const context = SPACE_CONTEXT.exec(sentence.text);
  if (!context) return null;
  return `The ${cleanPhrase(context[1])} ${context[2].toLowerCase()} ${cleanPhrase(
    context[3],
  )}.`;
}

function splitUserSentences(messages: HighConfidenceFactMessage[]): Sentence[] {
  const sentences: Sentence[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "user") return;
    const content = typeof message.content === "string" ? message.content : "";
    for (const part of content.split(/(?<=[.!?])\s+|\n+/)) {
      const text = part.trim().replace(/\s+/g, " ");
      if (!text) continue;
      sentences.push({
        text: stripTrailingPunctuation(text),
        messageIndex,
        timestamp: message.timestamp,
      });
    }
  });
  return sentences;
}

function previousSentenceInSameMessage(
  sentences: Sentence[],
  sentence: Sentence,
): Sentence | null {
  const index = sentences.indexOf(sentence);
  if (index <= 0) return null;
  const previous = sentences[index - 1];
  return previous.messageIndex === sentence.messageIndex ? previous : null;
}

function makeFact(
  scope: HighConfidenceFactScope,
  kind: HighConfidenceFactKind,
  text: string,
  sentence: Sentence,
): ExtractedHighConfidenceFact {
  return {
    id: `${scope}:${hashText(`${kind}:${text}`)}`,
    scope,
    kind,
    text,
    sourceText: sentence.text,
    sourceMessageIndex: sentence.messageIndex,
    timestamp: sentence.timestamp,
    confidence: "high",
  };
}

function dedupeFacts(
  facts: ExtractedHighConfidenceFact[],
): ExtractedHighConfidenceFact[] {
  const seen = new Set<string>();
  const out: ExtractedHighConfidenceFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
  }
  return out;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function petNoun(value: string): string {
  const noun = cleanNoun(value.replace(/\bnew\s+/i, ""));
  if (noun === "puppy") return "dog";
  if (noun === "kitten") return "cat";
  return noun || "pet";
}

function cleanName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9 '-]/g, "");
}

function cleanNoun(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, " ");
}

function cleanPhrase(value: string): string {
  return stripTrailingPunctuation(value).trim().replace(/\s+/g, " ");
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}
