import { useEffect, useState } from "react";
import { AlertCircle, BrainCircuit, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getAgentContextPolicy,
  type AgentContextPolicy,
} from "@/lib/context-engine-api";

interface AgentContextPolicyBadgeProps {
  agentId: string;
}

export function AgentContextPolicyBadge({
  agentId,
}: AgentContextPolicyBadgeProps) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<AgentContextPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAgentContextPolicy(agentId)
      .then((next) => {
        if (cancelled) return;
        setPolicy(next);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        <Badge
          variant={policy?.enabled ? "secondary" : "outline"}
          className={`cursor-pointer gap-1.5 hover:bg-accent transition-colors ${!policy?.enabled ? "text-muted-foreground" : ""}`}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <BrainCircuit className="h-3 w-3" />
          )}
          Context
        </Badge>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-muted-foreground" />
              Company Brain Policy
              {policy && (
                <Badge variant={policy.enabled ? "secondary" : "outline"}>
                  {policy.enabled ? "enabled" : "disabled"}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <PolicyDialogContent
              loading={loading}
              error={error}
              policy={policy}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PolicyDialogContent({
  loading,
  error,
  policy,
}: {
  loading: boolean;
  error: string | null;
  policy: AgentContextPolicy | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading policy...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 text-yellow-500" />
        <p>
          {error.includes("Unknown tool")
            ? "Effective policy is unavailable until the Company Brain API deploy includes the admin policy tool."
            : error}
        </p>
      </div>
    );
  }

  if (!policy) return null;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <PolicyColumn title="Tenant defaults" providers={policy.tenantDefaults} />
      <PolicyColumn
        title={
          policy.templateOverride.mode === "inherit"
            ? "Template override"
            : "Template selection"
        }
        providers={
          policy.templateOverride.mode === "inherit"
            ? []
            : policy.finalProviders
        }
        empty={
          policy.templateOverride.mode === "inherit"
            ? "Inherits tenant defaults"
            : "No adapters selected"
        }
      />
      <PolicyColumn
        title="Final providers"
        providers={policy.finalProviders}
        empty={
          policy.enabled ? "No sources will run" : "Company Brain disabled"
        }
      />
      {policy.providerOptions &&
        Object.keys(policy.providerOptions).length > 0 && (
          <div className="rounded-md border p-3 md:col-span-3">
            <p className="text-xs font-medium text-muted-foreground">
              Provider options
            </p>
            <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(policy.providerOptions, null, 2)}
            </pre>
          </div>
        )}
    </div>
  );
}

function PolicyColumn({
  title,
  providers,
  empty = "None",
}: {
  title: string;
  providers: AgentContextPolicy["finalProviders"];
  empty?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {providers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {providers.map((provider) => (
            <Badge key={provider.id} variant="outline" className="text-[11px]">
              {provider.displayName}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
