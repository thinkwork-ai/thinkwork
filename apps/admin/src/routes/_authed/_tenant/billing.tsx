import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Loader2,
  CreditCard,
  ExternalLink,
  AlertCircle,
  Check,
  Star,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { plans, type PlanId } from "@thinkwork/pricing-config";

// Thin REST client so we don't pull the urql graphql-client into this
// screen. Billing is the only caller for now; promote to shared helper
// if a second billing-surface lands.
const API_URL = import.meta.env.VITE_API_URL || "";

interface SubscriptionState {
  plan: string;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripePriceId: string | null;
  hasCustomer: boolean;
  customerEmail: string | null;
}

export const Route = createFileRoute("/_authed/_tenant/billing")({
  component: BillingPage,
});

function BillingPage() {
  useBreadcrumbs([{ label: "Billing" }]);
  const { getToken } = useAuth();

  const [state, setState] = useState<SubscriptionState | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);

  // Defense-in-depth role check: the sidebar hides Billing for non-owners,
  // but direct URL access shouldn't leak the UI. Short-circuit the
  // subscription fetch on non-owners to keep the gate fast.
  useEffect(() => {
    (async () => {
      setRoleLoading(true);
      try {
        const token = await getToken();
        if (!token) {
          setRole(null);
          return;
        }
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setRole(null);
          return;
        }
        const data = (await res.json()) as { role?: string | null };
        setRole(data.role ?? null);
      } finally {
        setRoleLoading(false);
      }
    })();
  }, [getToken]);

  useEffect(() => {
    if (roleLoading || role !== "owner") {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await fetch(`${API_URL}/api/stripe/subscription`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as SubscriptionState;
        setState(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  async function startUpgrade(planId: PlanId) {
    setUpgradingPlan(planId);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`${API_URL}/api/stripe/checkout-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: planId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Checkout did not return a URL");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUpgradingPlan(null);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`${API_URL}/api/stripe/portal-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Portal session did not return a URL");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPortalLoading(false);
    }
  }

  if (roleLoading || loading) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Billing"
            description="Subscription and payment details"
          />
        }
      >
        <PageSkeleton />
      </PageLayout>
    );
  }

  if (role !== "owner") {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Billing"
            description="Subscription and payment details"
          />
        }
      >
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
            <div className="text-sm">
              <div className="font-medium">Owner access only</div>
              <div className="text-muted-foreground mt-1">
                Billing is managed by the workspace owner. Ask them to
                open this page, or reach out to hello@thinkwork.ai if
                you need help.
              </div>
            </div>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Billing"
          description="Subscription and payment details"
        />
      }
    >
      {error && (
        <Card className="mb-6 border-red-500/40 bg-red-500/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-red-500" />
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Current Plan
            </CardTitle>
            <CardDescription>
              Your active subscription and renewal details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row
              label="Plan"
              value={
                <Badge variant="secondary" className="uppercase">
                  {state?.plan ?? "free"}
                </Badge>
              }
            />
            {state?.status && (
              <Row
                label="Status"
                value={<StatusBadge status={state.status} />}
              />
            )}
            {state?.currentPeriodEnd && (
              <Row
                label={
                  state.cancelAtPeriodEnd ? "Cancels on" : "Renews on"
                }
                value={formatDate(state.currentPeriodEnd)}
              />
            )}
            {state?.customerEmail && (
              <Row label="Billed to" value={state.customerEmail} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manage subscription</CardTitle>
            <CardDescription>
              Update your card, change plan, download invoices, or cancel
              — all from Stripe's secure portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {state?.hasCustomer ? (
              <Button
                onClick={openPortal}
                disabled={portalLoading}
                className="w-full"
              >
                {portalLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening portal…
                  </>
                ) : (
                  <>
                    Open Stripe portal
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            ) : (
              <div className="space-y-4 text-sm text-muted-foreground">
                <p>
                  You're on the free plan. Upgrade to unlock higher
                  limits, template-level capability grants, and priority
                  support.
                </p>
                <Button
                  className="w-full"
                  onClick={() => setPickerOpen(true)}
                >
                  See plans
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose a plan</DialogTitle>
            <DialogDescription>
              Payment redirects to Stripe Checkout. The subscription
              attaches to your current workspace on success — no data
              migration needed.
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
                    className={`flex flex-col rounded-xl border p-4 ${
                      plan.highlighted
                        ? "border-primary/60 bg-primary/5"
                        : "border-border"
                    } ${isDisabled ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{plan.name}</div>
                      {plan.highlighted && (
                        <Badge variant="default" className="gap-1">
                          <Star className="h-3 w-3" /> Recommended
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs font-medium uppercase tracking-wider mt-1">
                      {plan.tagline}
                    </div>
                    <p className="text-muted-foreground text-sm mt-2">
                      {plan.summary}
                    </p>
                    <ul className="my-4 space-y-2 flex-1">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      onClick={() => startUpgrade(plan.id)}
                      disabled={isDisabled || isPending}
                      variant={plan.highlighted ? "default" : "outline"}
                      className="w-full"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Opening checkout…
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
    </PageLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
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
