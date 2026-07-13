// Research view (THINK-280 U2): connection research over working knowledge
// (admitted/platform definitions) and research knowledge (stored proposals —
// non-executable evidence, visually distinct). Admission is an exact-
// fingerprint, single-use review: the Admit dialog captures the fingerprint
// at open and sends exactly that value; any payload change since review is
// rejected server-side.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { FlaskConical, Loader2, Search, TriangleAlert } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@thinkwork/ui";
import {
  AdmitConnectionProposalMutation,
  ConnectionResearchQuery,
  RejectConnectionProposalMutation,
} from "@/lib/capability-runtime-queries";
import {
  FingerprintChip,
  StatusBadge,
  parseAwsJson,
} from "@/components/settings/capability-runtime-shared";

type Proposal = {
  id: string;
  definitionId?: string | null;
  payload: unknown;
  payloadFingerprint: string;
  provenance: unknown;
  status: string;
  createdByActorType?: string | null;
  decidedAt?: string | null;
  createdAt: string;
};

/** Official-source URLs from the proposal's provenance JSON (best effort). */
export function provenanceSourceUrls(provenance: unknown): string[] {
  const parsed = parseAwsJson(provenance);
  if (parsed == null || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const candidates = [record.sourceUrls, record.source_urls, record.sources];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  }
  return [];
}

function DecisionDialog({
  proposal,
  mode,
  onClose,
  onConfirm,
  busy,
}: {
  proposal: Proposal;
  mode: "admit" | "reject";
  onClose: () => void;
  onConfirm: (args: { reviewedFingerprint: string; reason: string }) => void;
  busy: boolean;
}) {
  // Captured ONCE at dialog open — this is the fingerprint the operator
  // reviewed, and exactly what admission consumes (single-use exactness).
  const reviewedFingerprint = useRef(proposal.payloadFingerprint).current;
  const [reason, setReason] = useState("");
  const payload = parseAwsJson(proposal.payload);
  const urls = provenanceSourceUrls(proposal.provenance);
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        data-testid={`proposal-${mode}-dialog`}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "admit" ? "Review & admit proposal" : "Reject proposal"}
          </DialogTitle>
          <DialogDescription>
            {mode === "admit"
              ? "Admission signs exactly the descriptor you review here. If the payload changes after this review, the admission is rejected — re-review and approve again."
              : "Rejection is recorded with the reason below; the proposal stays visible as research history."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={proposal.status} />
            <FingerprintChip
              label="reviewed fingerprint"
              fingerprint={reviewedFingerprint}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Official sources
            </p>
            {urls.length === 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="proposal-no-sources"
              >
                No official source URLs recorded — admission will fail closed.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {urls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs break-all text-primary underline underline-offset-2"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Proposed descriptor payload
            </p>
            <pre
              className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
              data-testid="proposal-payload"
            >
              {payload == null
                ? "(payload unavailable)"
                : JSON.stringify(payload, null, 2)}
            </pre>
          </div>
          {mode === "reject" ? (
            <div className="space-y-1">
              <Label htmlFor="reject-reason">Reason (optional)</Label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this proposal shouldn't be admitted…"
                data-testid="proposal-reject-reason"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === "reject" ? "destructive" : "default"}
            onClick={() => onConfirm({ reviewedFingerprint, reason })}
            disabled={busy}
            data-testid={`proposal-${mode}-confirm`}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "admit" ? "Admit this exact version" : "Reject proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CapabilityResearchView({
  tenantId,
  canAdmit,
}: {
  tenantId: string;
  /** Admin-only gate for the Admit action (tenant owner/admin). */
  canAdmit: boolean;
}) {
  const [queryText, setQueryText] = useState("");
  const [allowExternal, setAllowExternal] = useState(false);
  const [submitted, setSubmitted] = useState<{
    query: string;
    allowExternal: boolean;
  } | null>(null);
  const [decision, setDecision] = useState<{
    proposal: Proposal;
    mode: "admit" | "reject";
  } | null>(null);
  // Keyboard focus returns to the row action that opened the review dialog.
  const decisionTriggerRef = useRef<HTMLElement | null>(null);

  const [result, refetch] = useQuery({
    query: ConnectionResearchQuery,
    variables: {
      tenantId,
      query: submitted?.query ?? "",
      allowExternal: submitted?.allowExternal ?? false,
    },
    pause: !tenantId || !submitted,
    requestPolicy: "network-only",
  });
  const [admitState, admitProposal] = useMutation(
    AdmitConnectionProposalMutation,
  );
  const [rejectState, rejectProposal] = useMutation(
    RejectConnectionProposalMutation,
  );
  const busy = admitState.fetching || rejectState.fetching;

  const payload = result.data?.connectionResearch ?? null;
  const definitions = payload?.definitions ?? [];
  const proposals = useMemo<Proposal[]>(
    () => (payload?.proposals ?? []) as Proposal[],
    [payload],
  );

  function closeDecision() {
    setDecision(null);
    // Restore focus to the originating row action after the dialog closes.
    const trigger = decisionTriggerRef.current;
    decisionTriggerRef.current = null;
    if (trigger) setTimeout(() => trigger.focus(), 0);
  }

  async function confirmDecision({
    reviewedFingerprint,
    reason,
  }: {
    reviewedFingerprint: string;
    reason: string;
  }) {
    if (!decision) return;
    const { proposal, mode } = decision;
    // Split branches so each response narrows to its own mutation result.
    let outcome: { outcome: string; reason?: string | null } | null | undefined;
    let errorMessage: string | undefined;
    if (mode === "admit") {
      const response = await admitProposal({
        input: { tenantId, proposalId: proposal.id, reviewedFingerprint },
      });
      errorMessage = response.error?.message;
      outcome = response.data?.admitConnectionProposal;
    } else {
      const response = await rejectProposal({
        tenantId,
        proposalId: proposal.id,
        reason: reason.trim() || undefined,
      });
      errorMessage = response.error?.message;
      outcome = response.data?.rejectConnectionProposal;
    }
    if (errorMessage || !outcome) {
      toast.error(
        `Couldn't ${mode} the proposal: ${errorMessage ?? "no result"}`,
      );
      return;
    }
    if (outcome.outcome === "rejected") {
      // Safe operator-readable reason, verbatim (fingerprint drift, sources…).
      toast.error(outcome.reason ?? `The ${mode} request was rejected.`);
    } else {
      toast.success(
        mode === "admit"
          ? "Proposal admitted — the signed version is now in the catalog."
          : "Proposal rejected.",
      );
    }
    closeDecision();
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <div className="space-y-4" data-testid="capability-research-view">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = queryText.trim();
          if (!trimmed) return;
          setSubmitted({ query: trimmed, allowExternal });
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="Search Connections — e.g. github, stripe invoices…"
            aria-label="Research query"
            data-testid="research-query-input"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!queryText.trim() || result.fetching}
            data-testid="research-submit"
          >
            <Search className="size-4" />
            Search
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allowExternal}
            onCheckedChange={(checked) => setAllowExternal(checked === true)}
            data-testid="research-allow-external"
          />
          Include external discovery (bounded) — size/time limited, cached with
          expiry. Off = stored knowledge only.
        </label>
      </form>

      {!submitted ? (
        <p
          className="py-6 text-sm text-muted-foreground"
          data-testid="research-idle"
        >
          Search to see working definitions and stored research proposals for a
          provider. Research results are evidence — nothing here executes until
          an operator admits a version.
        </p>
      ) : result.fetching ? (
        <div className="space-y-2 py-2" data-testid="research-loading">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : result.error ? (
        <div className="space-y-2 py-6" data-testid="research-error">
          <p className="text-sm text-destructive" role="alert">
            Research failed: {result.error.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch({ requestPolicy: "network-only" })}
            data-testid="research-retry"
          >
            Retry
          </Button>
        </div>
      ) : payload ? (
        <div className="space-y-6">
          {payload.state === "degraded" ? (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
              data-testid="research-degraded"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                External discovery is unavailable or bounded out —
                {payload.stateDetail ? ` ${payload.stateDetail}. ` : " "}
                Stored results below are still complete; research availability
                never gates admission.
              </p>
            </div>
          ) : null}

          <section>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Working knowledge — admitted definitions
            </h3>
            {definitions.length === 0 ? (
              <p
                className="py-3 text-sm text-muted-foreground"
                data-testid="research-definitions-empty"
              >
                No admitted definitions match &ldquo;{submitted.query}&rdquo;.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {definitions.map((definition) => (
                  <div
                    key={definition.id}
                    className="flex flex-wrap items-center gap-2 py-2.5"
                    data-testid={`research-definition-${definition.slug}`}
                  >
                    <span className="text-sm font-medium">
                      {definition.displayName}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {definition.namespace}/{definition.slug}
                    </span>
                    <StatusBadge status={definition.status} />
                    {definition.admittedVersion ? (
                      <span className="text-xs text-muted-foreground">
                        admitted v{definition.admittedVersion.version}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        no admitted version
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <FlaskConical className="size-3.5" aria-hidden />
              Research — proposals (non-executable)
            </h3>
            {proposals.length === 0 ? (
              <p
                className="py-3 text-sm text-muted-foreground"
                data-testid="research-proposals-empty"
              >
                No stored proposals match &ldquo;{submitted.query}&rdquo;.
              </p>
            ) : (
              <div className="space-y-2">
                {proposals.map((proposal) => {
                  const urls = provenanceSourceUrls(proposal.provenance);
                  const decidable =
                    proposal.status === "draft" ||
                    proposal.status === "submitted";
                  return (
                    <div
                      key={proposal.id}
                      className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3"
                      data-testid={`research-proposal-${proposal.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        >
                          non-executable
                        </Badge>
                        <StatusBadge status={proposal.status} />
                        <FingerprintChip
                          fingerprint={proposal.payloadFingerprint}
                        />
                        <span className="text-xs text-muted-foreground">
                          {new Date(proposal.createdAt).toLocaleString()}
                          {proposal.createdByActorType
                            ? ` · by ${proposal.createdByActorType}`
                            : ""}
                        </span>
                        {decidable ? (
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {/* Admission is admin-only; members can still
                                reject stale research. */}
                            {canAdmit ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={(event) => {
                                  decisionTriggerRef.current =
                                    event.currentTarget;
                                  setDecision({ proposal, mode: "admit" });
                                }}
                                data-testid={`proposal-admit-${proposal.id}`}
                              >
                                Review & admit
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={(event) => {
                                decisionTriggerRef.current =
                                  event.currentTarget;
                                setDecision({ proposal, mode: "reject" });
                              }}
                              data-testid={`proposal-reject-${proposal.id}`}
                            >
                              Reject
                            </Button>
                          </span>
                        ) : null}
                      </div>
                      {urls.length > 0 ? (
                        <ul className="mt-2 space-y-0.5">
                          {urls.map((url) => (
                            <li key={url}>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs break-all text-primary underline underline-offset-2"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          No official source URLs recorded.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {decision ? (
        <DecisionDialog
          proposal={decision.proposal}
          mode={decision.mode}
          onClose={closeDecision}
          onConfirm={(args) => void confirmDecision(args)}
          busy={busy}
        />
      ) : null}
    </div>
  );
}
