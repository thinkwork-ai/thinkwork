import { UserPlus, Lightbulb, ShieldCheck, GitPullRequestDraft, AlertTriangle } from "lucide-react";

export const typeLabel: Record<string, string> = {
  hire_agent: "Hire Agent",
  approve_ceo_strategy: "CEO Strategy",
  workspace_review: "Workspace review",
};

export const typeIcon: Record<string, typeof UserPlus> = {
  hire_agent: UserPlus,
  approve_ceo_strategy: Lightbulb,
  workspace_review: GitPullRequestDraft,
};

export const defaultTypeIcon = ShieldCheck;

function PayloadField({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

export function HireAgentPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Name</span>
        <span className="font-medium">{String(payload.name ?? "—")}</span>
      </div>
      <PayloadField label="Role" value={payload.role} />
      <PayloadField label="Title" value={payload.title} />
      {!!payload.capabilities && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Capabilities</span>
          <span className="text-muted-foreground">{String(payload.capabilities)}</span>
        </div>
      )}
      {!!payload.adapterType && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Adapter</span>
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            {String(payload.adapterType)}
          </span>
        </div>
      )}
    </div>
  );
}

export function GenericPayload({ payload }: { payload: Record<string, unknown> }) {
  const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Title" value={payload.title} />
      {!!plan && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(plan)}
        </div>
      )}
      {!plan && (
        <pre className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-48">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function WorkspaceReviewPayload({ payload }: { payload: Record<string, unknown> }) {
  const classification = (payload.classification ?? {}) as {
    kind?: string;
    responsibleUserId?: string | null;
  };
  const isUnrouted = classification.kind === "unrouted";
  const targetPath = (payload.targetPath as string) ?? "/";
  const agentName = (payload.agentName as string) ?? null;
  const reason = (payload.reason as string) ?? null;
  const innerPayload = (payload.payload ?? {}) as Record<string, unknown>;
  const reviewBody =
    (innerPayload.reviewBody as string) ??
    (payload.reviewBody as string) ??
    null;
  const proposedChanges = Array.isArray(innerPayload.proposedChanges)
    ? (innerPayload.proposedChanges as Array<Record<string, unknown>>)
    : Array.isArray(payload.proposedChanges)
      ? (payload.proposedChanges as Array<Record<string, unknown>>)
      : [];

  return (
    <div className="mt-3 space-y-2 text-sm">
      {isUnrouted && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Unrouted: this run's agent chain has no human pair and no system
            terminator. Investigate the agent's `parent_agent_id` and
            `human_pair_id`.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {agentName && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0 text-xs">Agent</span>
            <span className="font-medium">{agentName}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">Target</span>
          <span className="font-mono text-xs">{targetPath}</span>
        </div>
        {reason && (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0 text-xs pt-0.5">Reason</span>
            <span className="text-muted-foreground">{reason}</span>
          </div>
        )}
      </div>
      {reviewBody && (
        <div className="mt-2">
          <div className="text-muted-foreground text-xs mb-1">Review file</div>
          <pre className="rounded-md bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
            {reviewBody}
          </pre>
        </div>
      )}
      {proposedChanges.length > 0 && (
        <div className="mt-2">
          <div className="text-muted-foreground text-xs mb-1">
            Proposed changes ({proposedChanges.length})
          </div>
          <div className="space-y-1.5">
            {proposedChanges.slice(0, 3).map((change, i) => (
              <div key={i} className="rounded-md border px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    {String(change.kind ?? "change")}
                  </span>
                  <span>{String(change.summary ?? change.path ?? "")}</span>
                </div>
                {Boolean(change.path) && (
                  <div className="font-mono text-muted-foreground mt-0.5">
                    {String(change.path)}
                  </div>
                )}
              </div>
            ))}
            {proposedChanges.length > 3 && (
              <div className="text-xs text-muted-foreground">
                + {proposedChanges.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function InboxItemPayloadRenderer({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  if (type === "hire_agent") return <HireAgentPayload payload={payload} />;
  if (type === "workspace_review") return <WorkspaceReviewPayload payload={payload} />;
  return <GenericPayload payload={payload} />;
}
