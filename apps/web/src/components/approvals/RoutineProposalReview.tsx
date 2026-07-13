// Routine promotion proposal review (THINK-280 U6): the operator approval
// surface for capability Routine bundles. Renders the immutable proposal
// payload (source, dependency contracts, fixtures, invariants, principal +
// effect) and the exact fingerprint under review.
//
// Approval is exact + single-use: the fingerprint is captured ONCE when the
// panel opens, and Approve sends exactly that captured value as
// reviewedFingerprint. If the proposal's live fingerprint drifts away from
// the captured one mid-review (a post-review edit supersedes the reviewed
// payload), Approve is disabled and a stale-approval notice prompts a
// re-review — a stale approval is never sent.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  RefreshCw,
  TriangleAlert,
  UserCheck,
  Wrench,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  Textarea,
} from "@thinkwork/ui";
import {
  ApproveRoutineProposalMutation,
  RejectRoutineProposalMutation,
  RoutineProposalQuery,
} from "@/lib/capability-runtime-queries";
import {
  FingerprintChip,
  StatusBadge,
  parseAwsJson,
} from "@/components/settings/capability-runtime-shared";

const POLL_INTERVAL_MS = 10_000;

type Proposal = {
  id: string;
  tenantId: string;
  routineId?: string | null;
  payload: unknown;
  payloadFingerprint: string;
  evidenceRefs: unknown;
  status: string;
  approvalMode?: string | null;
  approvalEvidence?: unknown;
  createdByActorType?: string | null;
  createdByActorId?: string | null;
  decidedAt?: string | null;
  decidedByUserId?: string | null;
  promotedCommitSha?: string | null;
  createdAt: string;
};

/** The immutable bundle persisted in `payload` (parsed defensively). */
type ProposalBundle = {
  slug?: string;
  code?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  fixtures?: Array<{ path?: string; input?: unknown; expected?: unknown }>;
  invariants?: unknown[];
  dependencies?: Array<{
    twcap?: string;
    contractHash?: string;
    definitionVersionId?: string;
  }>;
  minimumGrants?: unknown;
  principal?: { mode?: string; servicePrincipalId?: string | null };
  effectSummary?: {
    effect?: string;
    dataClasses?: unknown;
    costClass?: string;
    budgets?: unknown;
  };
  evidence?: unknown;
};

type PromotionSummary = {
  promotionOutcome?: string | null;
  promotedCommitSha?: string | null;
  validatedSha?: string | null;
  hermetic?: unknown;
};

function asBundle(payload: unknown): ProposalBundle | null {
  const parsed = parseAwsJson(payload);
  return parsed && typeof parsed === "object"
    ? (parsed as ProposalBundle)
    : null;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "(unrenderable)";
  }
}

export function RoutineProposalReview({
  proposalId,
  tenantId,
}: {
  proposalId: string;
  tenantId: string;
}) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    routineProposal: Proposal | null;
  }>({
    query: RoutineProposalQuery,
    variables: { id: proposalId },
  });
  const [approveState, approveProposal] = useMutation(
    ApproveRoutineProposalMutation,
  );
  const [rejectState, rejectProposal] = useMutation(
    RejectRoutineProposalMutation,
  );
  const busy = approveState.fetching || rejectState.fetching;

  const proposal = data?.routineProposal ?? null;

  // Fingerprint + status captured ONCE at panel open — the exact payload the
  // operator reviewed. Approve sends exactly the captured fingerprint
  // (single-use exactness); Refresh re-captures from the live proposal.
  const [reviewed, setReviewed] = useState<{
    fingerprint: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    if (proposal && reviewed == null) {
      setReviewed({
        fingerprint: proposal.payloadFingerprint,
        status: proposal.status,
      });
    }
  }, [proposal, reviewed]);
  const reviewedFingerprint = reviewed?.fingerprint ?? null;

  // Set after OUR approve/reject applied — a status change we caused is not
  // a mid-review invalidation.
  const [locallyDecided, setLocallyDecided] = useState(false);
  // Set when the server rejects an approve as stale/decided — renders the
  // same stale-approval notice as client-side drift detection.
  const [serverStale, setServerStale] = useState(false);

  // Mid-review invalidation (AE6): the live fingerprint drifted away from
  // the captured one, OR the proposal left 'submitted' under us (decided or
  // superseded elsewhere). Either disables Approve and prompts a refresh.
  const staleFingerprint =
    proposal != null &&
    reviewedFingerprint != null &&
    proposal.payloadFingerprint !== reviewedFingerprint;
  const staleStatus =
    proposal != null &&
    reviewed != null &&
    reviewed.status === "submitted" &&
    proposal.status !== "submitted" &&
    !locallyDecided;
  const stale = staleFingerprint || staleStatus || serverStale;

  const decidable =
    proposal?.status === "draft" || proposal?.status === "submitted";

  // Re-read the proposal while a decision is still possible — a 10s interval
  // plus a window-focus refetch — so a post-review edit (superseded payload →
  // new fingerprint) surfaces mid-review.
  useEffect(() => {
    if (!decidable) return;
    const poll = () => refetch({ requestPolicy: "network-only" });
    const t = setInterval(poll, POLL_INTERVAL_MS);
    window.addEventListener("focus", poll);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", poll);
    };
  }, [decidable, refetch]);

  // Promotion verdict returned by the approve mutation.
  const [promotion, setPromotion] = useState<PromotionSummary | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Keyboard focus returns to the action that opened the reject dialog.
  const rejectTriggerRef = useRef<HTMLElement | null>(null);

  const bundle = useMemo(() => asBundle(proposal?.payload), [proposal]);

  if (fetching && !data) {
    return (
      <div className="space-y-2 py-2" data-testid="routine-proposal-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }
  if (error || !proposal) {
    return (
      <div className="space-y-2 py-6" data-testid="routine-proposal-error">
        <p className="text-sm text-destructive" role="alert">
          {error
            ? `Couldn't load the Routine proposal: ${error.message}`
            : "Routine proposal not found."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch({ requestPolicy: "network-only" })}
          data-testid="routine-proposal-retry"
        >
          Retry
        </Button>
      </div>
    );
  }

  function closeReject() {
    setRejectOpen(false);
    const trigger = rejectTriggerRef.current;
    rejectTriggerRef.current = null;
    if (trigger) setTimeout(() => trigger.focus(), 0);
  }

  async function handleApprove() {
    if (!reviewedFingerprint || stale || proposal?.status !== "submitted") {
      return;
    }
    const response = await approveProposal({
      input: { tenantId, proposalId, reviewedFingerprint },
    });
    const result = response.data?.approveRoutineProposal;
    if (response.error || !result) {
      toast.error(
        `Couldn't approve the proposal: ${response.error?.message ?? "no result"}`,
      );
      return;
    }
    if (result.outcome === "rejected") {
      if (result.reason === "stale_or_decided_fingerprint") {
        // The payload changed (or was decided) between review and approve —
        // render the same stale-approval notice as client-side detection.
        setServerStale(true);
      }
      // Safe operator-readable reason, verbatim (fingerprint drift, etc.).
      toast.error(result.reason ?? "The approval was rejected.");
    } else {
      setLocallyDecided(true);
      setPromotion(result);
      toast.success("Proposal approved — promotion verdict below.");
    }
    refetch({ requestPolicy: "network-only" });
  }

  async function handleReject() {
    const response = await rejectProposal({
      tenantId,
      proposalId,
      reason: rejectReason.trim() || undefined,
    });
    const result = response.data?.rejectRoutineProposal;
    if (response.error || !result) {
      toast.error(
        `Couldn't reject the proposal: ${response.error?.message ?? "no result"}`,
      );
      return;
    }
    if (result.outcome === "rejected") {
      toast.error(result.reason ?? "The rejection was not applied.");
    } else {
      toast.success("Proposal rejected.");
    }
    closeReject();
    refetch({ requestPolicy: "network-only" });
  }

  const dependencies = bundle?.dependencies ?? [];
  const fixtures = bundle?.fixtures ?? [];
  const invariants = (bundle?.invariants ?? []).filter(
    (entry): entry is string => typeof entry === "string",
  );
  const hermetic = parseAwsJson(promotion?.hermetic) as {
    status?: string;
    fixtures?: Array<{ path?: string; passed?: boolean; detail?: string }>;
  } | null;
  const approvalEvidence = parseAwsJson(proposal.approvalEvidence);

  return (
    <article
      className="grid min-w-0 gap-4"
      data-testid="routine-proposal-review"
    >
      <header className="grid gap-3 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-md">
            routine promotion
          </Badge>
          <StatusBadge status={proposal.status} />
          <FingerprintChip
            label="reviewed fingerprint"
            fingerprint={reviewedFingerprint ?? proposal.payloadFingerprint}
          />
          <span className="text-xs text-muted-foreground">
            {new Date(proposal.createdAt).toLocaleString()}
            {proposal.createdByActorType
              ? ` · by ${proposal.createdByActorType}`
              : ""}
          </span>
        </div>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Promote Routine {bundle?.slug ? `“${bundle.slug}”` : "bundle"}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Approval signs exactly the bundle fingerprint you review here. Any
            edit after this review produces a new proposal with a new
            fingerprint — a stale approval never commits or activates code.
          </p>
        </div>
      </header>

      {bundle == null ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="routine-proposal-payload-error"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The proposal payload could not be parsed — the panels below are empty.
          Refresh and re-review before deciding.
        </div>
      ) : null}

      {stale ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          data-testid="routine-proposal-stale-notice"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p>
              {staleFingerprint || serverStale
                ? "This proposal changed while you were reviewing it — the payload under review is stale. Approve is disabled; refresh to review the current version."
                : "This proposal was decided or superseded while you were reviewing it. Approve is disabled; refresh to see its current state."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Re-capture: the live payload becomes the reviewed payload.
                setReviewed({
                  fingerprint: proposal.payloadFingerprint,
                  status: proposal.status,
                });
                setServerStale(false);
                refetch({ requestPolicy: "network-only" });
              }}
              data-testid="routine-proposal-refresh"
            >
              <RefreshCw className="size-4" />
              Refresh review
            </Button>
          </div>
        </div>
      ) : null}

      {decidable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            className="gap-2"
            disabled={
              busy ||
              stale ||
              !reviewedFingerprint ||
              proposal.status !== "submitted"
            }
            onClick={() => void handleApprove()}
            data-testid="routine-proposal-approve"
          >
            {approveState.fetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Approve this exact version
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={busy}
            onClick={(event) => {
              rejectTriggerRef.current = event.currentTarget;
              setRejectOpen(true);
            }}
            data-testid="routine-proposal-reject"
          >
            <X className="size-4" />
            Reject
          </Button>
        </div>
      ) : (
        <div
          className="rounded-lg border border-border/70 px-3 py-2 text-sm"
          data-testid="routine-proposal-decision"
        >
          {proposal.status === "approved" || proposal.status === "promoted" ? (
            <div className="space-y-1">
              {/* Approval mode is icon + label, never color alone. */}
              <p
                className="flex items-center gap-1.5 font-medium"
                data-testid="routine-proposal-approval-mode"
              >
                {proposal.approvalMode === "repair" ? (
                  <Wrench className="size-4 shrink-0" aria-hidden />
                ) : (
                  <UserCheck className="size-4 shrink-0" aria-hidden />
                )}
                {proposal.approvalMode === "repair"
                  ? "Repair-approved (machine)"
                  : "Operator-approved"}
              </p>
              <p className="text-xs text-muted-foreground">
                {proposal.approvalMode === "repair"
                  ? "Published by the repair path with a structured-field diff and a green hermetic fixture run as evidence — no human decision."
                  : `Approved by an operator${
                      proposal.decidedByUserId
                        ? ` (${proposal.decidedByUserId})`
                        : ""
                    }.`}
                {proposal.decidedAt
                  ? ` Decided ${new Date(proposal.decidedAt).toLocaleString()}.`
                  : ""}
              </p>
              {proposal.promotedCommitSha ? (
                <p className="font-mono text-xs text-muted-foreground">
                  promoted commit {proposal.promotedCommitSha}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">
              This proposal is {proposal.status} — no decision is available.
            </p>
          )}
          {approvalEvidence != null ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
              {compactJson(approvalEvidence)}
            </pre>
          ) : null}
        </div>
      )}

      {promotion ? (
        <Card data-testid="routine-proposal-promotion">
          <CardHeader>
            <CardTitle>Promotion verdict</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={promotion.promotionOutcome ?? "unknown"} />
              {promotion.promotedCommitSha ? (
                <span className="font-mono text-xs">
                  commit {promotion.promotedCommitSha}
                </span>
              ) : null}
              {promotion.validatedSha ? (
                <span className="font-mono text-xs">
                  validated {promotion.validatedSha}
                </span>
              ) : null}
            </div>
            <p
              className="text-xs text-muted-foreground"
              data-testid="routine-proposal-promotion-detail"
            >
              {promotion.promotionOutcome === "promoted"
                ? "The bundle committed, passed the hermetic fixture gate, and is now the Routine's validated code."
                : promotion.promotionOutcome === "validation_failed"
                  ? "The commit landed but the hermetic fixture gate failed — the SHA was NOT promoted to validated code. Review the fixture results below."
                  : promotion.promotionOutcome === "commit_conflict"
                    ? "Another commit reached the repo head first — nothing was written. This is retryable: refresh the review and approve again against the current head."
                    : "Promotion hit an unexpected error — nothing was activated. The approval is recorded; retry the promotion or inspect the proposal's approval evidence."}
            </p>
            {hermetic ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Hermetic fixture gate: {hermetic.status ?? "unknown"}
                </p>
                <ul className="space-y-0.5 text-xs">
                  {(hermetic.fixtures ?? []).map((fixture, index) => (
                    <li key={fixture.path ?? index} className="font-mono">
                      {fixture.passed ? "✓" : "✗"} {fixture.path}
                      {fixture.detail ? ` — ${fixture.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="routine-proposal-code">
        <CardHeader>
          <CardTitle>Source code</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre">
            {bundle?.code ?? "(no code in bundle)"}
          </pre>
        </CardContent>
      </Card>

      <Card data-testid="routine-proposal-dependencies">
        <CardHeader>
          <CardTitle>Dependency contracts</CardTitle>
        </CardHeader>
        <CardContent>
          {dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No capability dependencies declared.
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {dependencies.map((dep, index) => (
                <li
                  key={`${dep.twcap ?? "dep"}-${index}`}
                  className="rounded-md bg-muted/40 px-3 py-2"
                >
                  <span className="font-mono text-xs">{dep.twcap}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    contract {dep.contractHash}
                  </span>
                  {dep.definitionVersionId ? (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      version {dep.definitionVersionId}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="routine-proposal-fixtures">
        <CardHeader>
          <CardTitle>Fixtures</CardTitle>
        </CardHeader>
        <CardContent>
          {fixtures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fixtures — promotion requires at least one.
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {fixtures.map((fixture, index) => (
                <li
                  key={fixture.path ?? index}
                  className="rounded-md bg-muted/40 px-3 py-2"
                >
                  <p className="font-mono text-xs">{fixture.path}</p>
                  <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                    {`input: ${compactJson(fixture.input)}\nexpected: ${compactJson(fixture.expected)}`}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="routine-proposal-invariants">
        <CardHeader>
          <CardTitle>Invariants</CardTitle>
        </CardHeader>
        <CardContent>
          {invariants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invariants declared.
            </p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {invariants.map((invariant) => (
                <li
                  key={invariant}
                  className="rounded-md bg-muted/40 px-3 py-1.5 font-mono text-xs"
                >
                  {invariant}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="routine-proposal-principal-effect">
        <CardHeader>
          <CardTitle>Principal &amp; effect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              principal: {bundle?.principal?.mode ?? "unspecified"}
            </Badge>
            {bundle?.principal?.servicePrincipalId ? (
              <span className="font-mono text-xs text-muted-foreground">
                service principal {bundle.principal.servicePrincipalId}
              </span>
            ) : null}
            <Badge variant="outline">
              effect: {bundle?.effectSummary?.effect ?? "unspecified"}
            </Badge>
            {bundle?.effectSummary?.costClass ? (
              <Badge variant="outline">
                cost: {bundle.effectSummary.costClass}
              </Badge>
            ) : null}
          </div>
          {bundle?.effectSummary?.dataClasses != null ||
          bundle?.effectSummary?.budgets != null ||
          bundle?.minimumGrants != null ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {compactJson({
                dataClasses: bundle?.effectSummary?.dataClasses ?? null,
                budgets: bundle?.effectSummary?.budgets ?? null,
                minimumGrants: bundle?.minimumGrants ?? null,
              })}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="routine-proposal-evidence">
        <CardHeader>
          <CardTitle>Evidence references</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {compactJson(parseAwsJson(proposal.evidenceRefs))}
          </pre>
        </CardContent>
      </Card>

      {rejectOpen ? (
        <Dialog
          open
          onOpenChange={(open) => (!open ? closeReject() : undefined)}
        >
          <DialogContent data-testid="routine-proposal-reject-dialog">
            <DialogHeader>
              <DialogTitle>Reject Routine proposal</DialogTitle>
              <DialogDescription>
                Rejection is recorded with the reason below; nothing is
                committed or activated.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor="routine-proposal-reject-reason">
                Reason (optional)
              </Label>
              <Textarea
                id="routine-proposal-reject-reason"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Why this bundle shouldn't be promoted…"
                data-testid="routine-proposal-reject-reason"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeReject} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleReject()}
                disabled={busy}
                data-testid="routine-proposal-reject-confirm"
              >
                {rejectState.fetching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Reject proposal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}
