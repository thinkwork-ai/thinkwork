const FORBIDDEN_PUBLICATION_PATTERNS: Array<{
  code: string;
  pattern: RegExp;
}> = [
  { code: "synthetic_secret_sentinel", pattern: /SECRET_SENTINEL_[A-Z0-9_-]+/ },
  { code: "synthetic_private_note", pattern: /\bprivate-[a-z0-9-]{3,128}\b/i },
  { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~-]{20,}/i },
  {
    code: "jwt_compact_token",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  },
  {
    code: "credential_assignment",
    pattern:
      /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*\S+/i,
  },
  {
    code: "identity_consent_uri",
    pattern:
      /https:\/\/bedrock-agentcore\.[a-z0-9-]+\.amazonaws\.com\/identities\/oauth2\/authorize\?/i,
  },
];

export class HarnessPublicationBlockedError extends Error {
  constructor(public readonly reasonCode: string) {
    super(`Harness publication blocked (${reasonCode})`);
    this.name = "HarnessPublicationBlockedError";
  }
}

/** Fail closed before public message insertion, retention, or artifacts. */
export function guardHarnessPublication(content: string): void {
  for (const candidate of FORBIDDEN_PUBLICATION_PATTERNS) {
    if (candidate.pattern.test(content)) {
      throw new HarnessPublicationBlockedError(candidate.code);
    }
  }
}
