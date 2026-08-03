import { useMemo } from "react";
import { AlertTriangle, Check, Inbox, MailOpen, X } from "lucide-react";
import { Avatar, AvatarFallback, Button } from "@thinkwork/ui";
import {
  formatApprovalDate,
  isEmailSendApproval,
  summarizeApproval,
  type ApprovalSummary,
  type ComputerApproval,
  type EmailDraft,
} from "@/components/approvals/approval-types";

interface ApprovalsMailAppProps {
  approvals: ComputerApproval[];
  selectedId: string | null;
  isLoading?: boolean;
  error?: string | null;
  isSubmitting?: boolean;
  submitError?: string | null;
  onSelect: (id: string) => void;
  onApprove: (id: string, decisionValues?: Record<string, unknown>) => void;
  onDeny: (id: string) => void;
}

/**
 * Two-pane mail-client layout for pending approvals: a message list on the
 * left, a reading pane on the right. The reading pane owns its scroll — long
 * email bodies scroll inside the pane instead of clipping.
 */
export function ApprovalsMailApp({
  approvals,
  selectedId,
  isLoading = false,
  error,
  isSubmitting = false,
  submitError,
  onSelect,
  onApprove,
  onDeny,
}: ApprovalsMailAppProps) {
  const selected = useMemo(
    () => approvals.find((approval) => approval.id === selectedId) ?? null,
    [approvals, selectedId],
  );

  return (
    <div className="flex min-h-0 w-full flex-1">
      <aside
        className="flex w-[340px] shrink-0 flex-col border-r border-border/70"
        aria-label="Pending approvals"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <ListState label="Loading approvals" />
          ) : error ? (
            <ListState label={error} tone="error" />
          ) : approvals.length === 0 ? (
            <ListState
              label="No pending approvals"
              detail="ThinkWork will pause here when it needs your decision."
            />
          ) : (
            <ul>
              {approvals.map((approval) => (
                <ApprovalListRow
                  key={approval.id}
                  approval={approval}
                  isSelected={approval.id === selectedId}
                  onSelect={() => onSelect(approval.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-live="polite">
        {selected ? (
          <ApprovalReadingPane
            approval={selected}
            isSubmitting={isSubmitting}
            submitError={submitError}
            onApprove={(decisionValues) => onApprove(selected.id, decisionValues)}
            onDeny={() => onDeny(selected.id)}
          />
        ) : (
          <EmptyReadingPane hasItems={approvals.length > 0} />
        )}
      </section>
    </div>
  );
}

function ApprovalListRow({
  approval,
  isSelected,
  onSelect,
}: {
  approval: ComputerApproval;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const summary = summarizeApproval(approval);
  const email = emailFields(summary);

  return (
    <li className="border-b border-border/40">
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? "true" : undefined}
        className={[
          "grid w-full min-w-0 gap-1 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected ? "bg-accent/70" : "hover:bg-accent/30",
        ].join(" ")}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {email ? email.to || "Unknown recipient" : summary.question}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatApprovalDate(approval.createdAt)}
          </span>
        </span>
        <span className="min-w-0 truncate text-sm text-foreground/90">
          {email ? email.subject || "(no subject)" : summary.actionType}
        </span>
        <span className="line-clamp-2 min-w-0 text-xs leading-4 text-muted-foreground">
          {email ? email.body || "" : summary.actionDescription}
        </span>
      </button>
    </li>
  );
}

function ApprovalReadingPane({
  approval,
  isSubmitting,
  submitError,
  onApprove,
  onDeny,
}: {
  approval: ComputerApproval;
  isSubmitting: boolean;
  submitError?: string | null;
  onApprove: (decisionValues?: Record<string, unknown>) => void;
  onDeny: () => void;
}) {
  const summary = summarizeApproval(approval);
  const email = emailFields(summary);
  const fromAddress = extractFromAddress(summary);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <h2 className="text-sm font-semibold tracking-tight">
          {email ? "Send Email" : "Approval"}
        </h2>
        <span className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={isSubmitting}
            onClick={() => onApprove()}
          >
            <Check className="size-4" />
            {email ? "Approve & send" : "Approve"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={isSubmitting}
            onClick={onDeny}
          >
            <X className="size-4" />
            Deny
          </Button>
        </span>
      </div>

      {submitError ? (
        <div className="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {submitError}
        </div>
      ) : null}

      <header className="shrink-0 border-b border-border/70 px-6 pb-4 pt-5">
        <h2 className="text-xl font-semibold tracking-tight">
          {email ? email.subject || "(no subject)" : summary.question}
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>
              {initials(email ? email.to : summary.actionType)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {email ? (
              <>
                <p className="truncate text-sm text-foreground">
                  To: <span className="font-medium">{email.to || "—"}</span>
                </p>
                {fromAddress ? (
                  <p className="truncate text-xs text-muted-foreground">
                    From: {fromAddress}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                {summary.actionDescription}
              </p>
            )}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            Requested {formatApprovalDate(approval.createdAt)}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {email ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-foreground">
            {email.body || ""}
          </pre>
        ) : (
          <div className="grid gap-4">
            {summary.evidence.length > 0 ? (
              <ul className="grid gap-2 text-sm text-muted-foreground">
                {summary.evidence.map((item) => (
                  <li key={item} className="rounded-md bg-muted/40 px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              {JSON.stringify(summary.rawConfig, null, 2)}
            </pre>
          </div>
        )}
      </div>

    </>
  );
}

function EmptyReadingPane({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      {hasItems ? (
        <MailOpen className="size-6 text-muted-foreground" />
      ) : (
        <Inbox className="size-6 text-muted-foreground" />
      )}
      <p className="text-sm font-medium">
        {hasItems ? "Select an approval" : "No pending approvals"}
      </p>
      <p className="text-xs text-muted-foreground">
        {hasItems
          ? "Choose an item from the list to review it."
          : "ThinkWork will pause here when it needs your decision."}
      </p>
    </div>
  );
}

function ListState({
  label,
  detail,
  tone,
}: {
  label: string;
  detail?: string;
  tone?: "error";
}) {
  return (
    <div className="grid gap-1 px-4 py-6 text-center">
      <p
        className={
          tone === "error"
            ? "text-sm text-destructive"
            : "text-sm font-medium text-foreground"
        }
      >
        {label}
      </p>
      {detail ? (
        <p className="text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function emailFields(summary: ApprovalSummary): EmailDraft | null {
  return isEmailSendApproval(summary) ? (summary.emailDraft ?? null) : null;
}

function extractFromAddress(summary: ApprovalSummary): string | null {
  const channel = summary.rawConfig.emailChannel;
  if (channel && typeof channel === "object" && !Array.isArray(channel)) {
    const from = (channel as Record<string, unknown>).from;
    if (typeof from === "string" && from.trim()) return from.trim();
  }
  return null;
}

function initials(value?: string | null): string {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return "?";
  const localPart = cleaned.includes("@") ? cleaned.split("@")[0] : cleaned;
  const parts = localPart.split(/[.\s_-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || first.toUpperCase() || "?";
}
