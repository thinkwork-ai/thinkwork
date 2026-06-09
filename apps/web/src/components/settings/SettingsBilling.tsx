import { useEffect, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, Star } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import { plans, type PlanId } from "@thinkwork/pricing-config";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { readRuntimeEnv } from "@/lib/runtime-config";

interface SubscriptionState {
  plan: string;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripePriceId: string | null;
  hasCustomer: boolean;
  customerEmail: string | null;
}

export function SettingsBilling() {
  const { getToken } = useAuth();
  const { role, roleResolved } = useTenant();

  const [state, setState] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);

  useEffect(() => {
    if (!roleResolved) return;
    if (role !== "owner") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await fetch(
          `${readRuntimeEnv("VITE_API_URL")}/api/stripe/subscription`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as SubscriptionState;
        if (!cancelled) setState(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, role, roleResolved]);

  async function startUpgrade(planId: PlanId) {
    setUpgradingPlan(planId);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(
        `${readRuntimeEnv("VITE_API_URL")}/api/stripe/checkout-session`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ plan: planId }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Checkout did not return a URL");
      window.open(data.url, "_blank", "noopener,noreferrer");
      setUpgradingPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUpgradingPlan(null);
    }
  }

  type PortalFlow =
    | "home"
    | "payment_method_update"
    | "subscription_cancel"
    | "subscription_update";

  async function openPortal(flow: PortalFlow = "home") {
    setPortalLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(
        `${readRuntimeEnv("VITE_API_URL")}/api/stripe/portal-session`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: flow === "home" ? undefined : JSON.stringify({ flow }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Portal session did not return a URL");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Billing"
        description="Subscription and payment details"
      />

      {!roleResolved || loading ? (
        <SettingsSection>
          <div className="flex items-center gap-2 px-4 py-3.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading billing details...
          </div>
        </SettingsSection>
      ) : role !== "owner" ? (
        <SettingsSection>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
              aria-hidden
            />
            <div className="text-sm">
              <div className="font-medium">Owner access only</div>
              <div className="mt-1 text-muted-foreground">
                Billing is managed by the workspace owner. Ask them to open this
                page, or reach out to hello@thinkwork.ai if you need help.
              </div>
            </div>
          </div>
        </SettingsSection>
      ) : (
        <>
          {error ? (
            <SettingsSection>
              <div className="flex items-start gap-3 px-4 py-3.5">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 flex-none text-destructive"
                  aria-hidden
                />
                <div className="text-sm text-destructive">{error}</div>
              </div>
            </SettingsSection>
          ) : null}

          <SettingsSection label="Current plan">
            <SettingsRow label="Plan">
              <Badge variant="secondary" className="uppercase">
                {state?.plan ?? "free"}
              </Badge>
            </SettingsRow>
            {state?.status ? (
              <SettingsRow label="Status">
                <StatusBadge status={state.status} />
              </SettingsRow>
            ) : null}
            {state?.currentPeriodEnd ? (
              <SettingsRow
                label={state.cancelAtPeriodEnd ? "Cancels on" : "Renews on"}
              >
                {formatDate(state.currentPeriodEnd)}
              </SettingsRow>
            ) : null}
            {state?.customerEmail ? (
              <SettingsRow label="Billed to">{state.customerEmail}</SettingsRow>
            ) : null}
            <SettingsRow
              label="Subscription"
              description={
                state?.hasCustomer
                  ? "Change plan, update your card, download invoices, or cancel inside Stripe's secure portal."
                  : "You're on the free plan. Upgrade to unlock higher limits and priority support."
              }
            >
              {state?.hasCustomer ? (
                <Button
                  size="sm"
                  onClick={() => void openPortal("home")}
                  disabled={portalLoading}
                >
                  {portalLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Opening...
                    </>
                  ) : (
                    <>
                      Manage
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setPickerOpen(true)}>
                  See plans
                </Button>
              )}
            </SettingsRow>
          </SettingsSection>
        </>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose a plan</DialogTitle>
            <DialogDescription>
              Payment redirects to Stripe Checkout. The subscription attaches to
              your current workspace on success.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((plan) => {
                const isPending = upgradingPlan === plan.id;
                const isDisabled =
                  upgradingPlan !== null && upgradingPlan !== plan.id;
                return (
                  <div
                    key={plan.id}
                    className={`flex flex-col rounded-lg border p-4 ${
                      plan.highlighted
                        ? "border-primary/60 bg-primary/5"
                        : "border-border"
                    } ${isDisabled ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{plan.name}</div>
                      {plan.highlighted ? (
                        <Badge variant="default" className="gap-1">
                          <Star className="h-3 w-3" aria-hidden />
                          Recommended
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs font-medium uppercase text-muted-foreground">
                      {plan.tagline}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {plan.summary}
                    </p>
                    <ul className="my-4 flex-1 space-y-2">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex gap-2 text-sm">
                          <Check
                            className="mt-0.5 h-4 w-4 flex-none text-primary"
                            aria-hidden
                          />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      onClick={() => void startUpgrade(plan.id)}
                      disabled={isDisabled || isPending}
                      variant={plan.highlighted ? "default" : "outline"}
                      className="w-full"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Opening...
                        </>
                      ) : (
                        plan.cta
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </SettingsPane>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: "default" | "secondary" | "destructive" | "outline" =
    status === "active" || status === "trialing"
      ? "default"
      : status === "past_due" || status === "unpaid"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={tone} className="capitalize">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
