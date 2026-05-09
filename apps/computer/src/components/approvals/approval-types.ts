export interface ComputerApproval {
  id: string;
  title?: string | null;
  description?: string | null;
  type: string;
  status: string;
  config?: unknown;
  createdAt?: string | null;
  expiresAt?: string | null;
}

export interface EmailDraft {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface ApprovalSummary {
  question: string;
  actionType: string;
  actionDescription: string;
  evidence: string[];
  emailDraft: EmailDraft | null;
  rawConfig: Record<string, unknown>;
}

export function summarizeApproval(approval: ComputerApproval): ApprovalSummary {
  const config = parseConfig(approval.config);
  const emailDraft = extractEmailDraft(config);

  return {
    question:
      textValue(config.question) ||
      textValue(config.questionText) ||
      approval.title?.trim() ||
      "Approval needed",
    actionType:
      textValue(config.actionType) ||
      textValue(config.action_type) ||
      textValue(config.kind) ||
      "computer_approval",
    actionDescription:
      textValue(config.actionDescription) ||
      textValue(config.action_description) ||
      textValue(config.description) ||
      approval.description?.trim() ||
      "Review the requested action before the Computer continues.",
    evidence: extractEvidence(config),
    emailDraft,
    rawConfig: config,
  };
}

export function isEmailSendApproval(summary: ApprovalSummary): boolean {
  return (
    summary.actionType === "email_send" ||
    summary.actionType === "gmail_send" ||
    summary.emailDraft !== null
  );
}

export function formatApprovalDate(value?: string | null): string {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function extractEmailDraft(config: Record<string, unknown>): EmailDraft | null {
  const candidates = [
    config.emailDraft,
    config.email_draft,
    config.draft,
    config.message,
  ];
  const draft = candidates.find(
    (candidate) => candidate && typeof candidate === "object",
  );
  if (!draft || Array.isArray(draft)) return null;
  const record = draft as Record<string, unknown>;
  return {
    to: textValue(record.to),
    subject: textValue(record.subject),
    body: textValue(record.body) || textValue(record.content),
  };
}

function extractEvidence(config: Record<string, unknown>): string[] {
  const value = config.evidence || config.sources || config.context;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return (
        textValue(record.title) ||
        textValue(record.label) ||
        textValue(record.url) ||
        textValue(record.id)
      );
    })
    .filter((item): item is string => Boolean(item));
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
