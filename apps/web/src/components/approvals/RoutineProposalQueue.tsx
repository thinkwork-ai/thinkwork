// Pending Routine promotion proposals (THINK-280 U6).
//
// Submitted proposals have NO inbox row until they are decided (the Inbox
// records the decision, not the request), so the approvals surface lists
// them straight from routineProposals(status: "submitted"). Each row links
// to /approvals/<proposalId> — the approval detail route resolves an id
// that isn't an inbox item as a Routine proposal.
import { Clock3, GitPullRequestArrow } from "lucide-react";
import { useQuery } from "urql";
import { Badge, Card } from "@thinkwork/ui";
import { RoutineProposalsQuery } from "@/lib/capability-runtime-queries";
import { formatApprovalDate } from "@/components/approvals/approval-types";
import { shortFingerprint } from "@/components/settings/capability-runtime-shared";

export function RoutineProposalQueue({
  tenantId,
  selectedId,
}: {
  tenantId: string | null;
  selectedId?: string | null;
}) {
  const [{ data, fetching, error }] = useQuery({
    query: RoutineProposalsQuery,
    variables: { tenantId: tenantId ?? "", status: "submitted" },
    pause: !tenantId,
  });
  const proposals = data?.routineProposals ?? [];

  if (!tenantId) return null;
  if (fetching && !data) {
    return (
      <Card
        className="gap-1 p-4 text-sm text-muted-foreground"
        data-testid="routine-proposal-queue-loading"
      >
        Loading Routine promotions…
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="gap-1 p-4" data-testid="routine-proposal-queue-error">
        <p className="text-sm text-destructive" role="alert">
          Couldn&rsquo;t load Routine promotions: {error.message}
        </p>
      </Card>
    );
  }
  // Nothing pending — stay out of the way (the computer-approval queue owns
  // the shared empty state).
  if (proposals.length === 0) return null;

  return (
    <section
      className="grid gap-3"
      aria-label="Pending Routine promotions"
      data-testid="routine-proposal-queue"
    >
      <h2 className="text-sm font-semibold text-muted-foreground">
        Routine promotions
      </h2>
      {proposals.map((proposal) => {
        const isSelected = proposal.id === selectedId;
        return (
          <a
            key={proposal.id}
            href={`/approvals/${proposal.id}`}
            data-testid={`routine-proposal-queue-row-${proposal.id}`}
            className={[
              "grid w-full min-w-0 gap-2 rounded-lg border border-border/70 bg-background/40 p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected ? "border-primary/70 bg-primary/10" : "",
            ].join(" ")}
          >
            <span className="flex min-w-0 items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <GitPullRequestArrow
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {proposal.routineId
                      ? "Routine update promotion"
                      : "New Routine promotion"}
                  </span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    fingerprint {shortFingerprint(proposal.payloadFingerprint)}
                  </span>
                </span>
              </span>
              <Badge variant="outline" className="rounded-md">
                routine promotion
              </Badge>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {formatApprovalDate(proposal.createdAt as string)}
              {proposal.createdByActorType
                ? ` · by ${proposal.createdByActorType}`
                : ""}
            </span>
          </a>
        );
      })}
    </section>
  );
}
