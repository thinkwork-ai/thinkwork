import { useEffect, useState } from "react";
import { View, ScrollView, ActivityIndicator, Modal, Pressable } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CreditCard,
  ExternalLink,
  AlertCircle,
  ArrowLeft,
  Check,
  Star,
  X,
} from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { Text, H2, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/theme";
import { plans, type PlanId } from "@thinkwork/pricing-config";
import { startStripeCheckout } from "@/lib/stripe-checkout";

// Mirror the stripe-checkout helper's API base resolution.
function resolveApiUrl(): string {
  const fromExtra =
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    "";
  const fromEnv = process.env.EXPO_PUBLIC_API_URL ?? "";
  return (fromExtra || fromEnv || "https://api.thinkwork.ai").replace(/\/$/, "");
}

interface SubscriptionState {
  plan: string;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  customerEmail: string | null;
}

export default function BillingScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [state, setState] = useState<SubscriptionState | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const apiUrl = resolveApiUrl();

        // Fetch role + subscription in parallel.
        const [meRes, subRes] = await Promise.all([
          fetch(`${apiUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${apiUrl}/api/stripe/subscription`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const meData = meRes.ok
          ? ((await meRes.json()) as { role?: string | null })
          : { role: null };
        const subData = subRes.ok
          ? ((await subRes.json()) as SubscriptionState)
          : null;

        if (cancelled) return;
        setRole(meData.role ?? null);
        setState(subData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function handleUpgrade(planId: PlanId) {
    setUpgradingPlan(planId);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const result = await startStripeCheckout(planId, { bearerToken: token });
      if (result.status === "completed") {
        // Upgrade: user is already authed, so just close the picker and
        // refetch the subscription. Stripe webhook attaches the sub to
        // the existing tenant; next focus will show the paid state.
        setPickerOpen(false);
        setUpgradingPlan(null);
        // Refetch subscription state after a short delay to let the
        // webhook land.
        setTimeout(async () => {
          try {
            const token2 = await getToken();
            if (!token2) return;
            const res = await fetch(
              `${resolveApiUrl()}/api/stripe/subscription`,
              { headers: { Authorization: `Bearer ${token2}` } },
            );
            if (res.ok) {
              setState((await res.json()) as SubscriptionState);
            }
          } catch {
            /* best-effort refetch */
          }
        }, 1500);
        return;
      }
      if (result.status === "error") {
        setError(result.message);
      }
      // cancel / dismiss / locked: user backed out of Stripe, no message.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
      const res = await fetch(`${resolveApiUrl()}/api/stripe/portal-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: flow === "home" ? undefined : JSON.stringify({ flow }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Portal session did not return a URL");

      // openBrowserAsync (not openAuthSessionAsync) — the Stripe portal
      // doesn't redirect back via a scheme, the user just hits Done in
      // the iOS Safari sheet when they're finished. Back in ThinkWork
      // the next focus triggers a subscription refetch.
      await WebBrowser.openBrowserAsync(data.url, {
        presentationStyle:
          WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <View className="flex-row items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <Button
          variant="ghost"
          size="icon-sm"
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <ArrowLeft size={20} color={colors.foreground} />
        </Button>
        <H2>Billing</H2>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : role !== "owner" ? (
          <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
            <View className="flex-row items-start gap-3">
              <AlertCircle size={18} color={colors.mutedForeground} />
              <View className="flex-1">
                <Text className="font-semibold mb-1">Owner access only</Text>
                <Muted className="leading-5">
                  Billing is managed by the workspace owner. Ask them to
                  open this screen, or email hello@thinkwork.ai for help.
                </Muted>
              </View>
            </View>
          </View>
        ) : (
          <View className="gap-5">
            {error && (
              <View className="rounded-xl border border-red-500/40 bg-red-500/10 p-3">
                <Text size="sm" className="text-red-300">
                  {error}
                </Text>
              </View>
            )}

            <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              <View className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex-row items-center gap-2">
                <CreditCard size={16} color={colors.mutedForeground} />
                <Text className="font-semibold">Current plan</Text>
              </View>
              <View className="px-4 py-3 gap-3">
                <Row
                  label="Plan"
                  value={(state?.plan ?? "free").toUpperCase()}
                />
                {state?.status && (
                  <Row
                    label="Status"
                    value={state.status.replace(/_/g, " ")}
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
              </View>
            </View>

            <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 gap-3">
              <Text className="font-semibold">Manage subscription</Text>
              {state?.hasCustomer ? (
                <>
                  <Muted className="leading-5">
                    Change plan, update your card, download invoices, or
                    cancel — all from Stripe's secure portal.
                  </Muted>
                  <Button
                    onPress={() => openPortal("home")}
                    disabled={portalLoading}
                    size="lg"
                  >
                    {portalLoading ? (
                      <View className="flex-row items-center gap-2">
                        <ActivityIndicator
                          size="small"
                          color={colors.background}
                        />
                        <Text>Opening portal…</Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center gap-2">
                        <Text>Manage subscription</Text>
                        <ExternalLink
                          size={14}
                          color={colors.background}
                        />
                      </View>
                    )}
                  </Button>
                  <Text
                    size="xs"
                    variant="muted"
                    className="leading-5 mt-2"
                  >
                    Cancel deactivates your workspace after the current
                    billing period. Data is retained for 30 days —
                    resubscribe within that window to restore everything.
                  </Text>
                </>
              ) : (
                <>
                  <Muted className="leading-5">
                    You're on the free plan. Upgrade to unlock higher
                    limits, template-level capability grants, and
                    priority support.
                  </Muted>
                  <Button
                    onPress={() => setPickerOpen(true)}
                    size="lg"
                  >
                    <Text>See plans</Text>
                  </Button>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => !upgradingPlan && setPickerOpen(false)}
      >
        <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <H2>Choose a plan</H2>
            <Pressable
              onPress={() => !upgradingPlan && setPickerOpen(false)}
              disabled={!!upgradingPlan}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={24} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          >
            <Muted className="leading-5 mb-4">
              Payment redirects to Stripe Checkout. The subscription
              attaches to your current workspace on success — your data
              and settings stay put.
            </Muted>
            <View className="gap-4">
              {plans.map((plan) => {
                const isPending = upgradingPlan === plan.id;
                const isDisabled =
                  upgradingPlan !== null && upgradingPlan !== plan.id;
                return (
                  <View
                    key={plan.id}
                    className={`rounded-xl border-2 p-4 ${
                      plan.highlighted
                        ? "border-primary bg-primary/5"
                        : "border-neutral-200 dark:border-neutral-700"
                    } ${isDisabled ? "opacity-40" : ""}`}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="font-bold text-lg">{plan.name}</Text>
                      {plan.highlighted && (
                        <View className="bg-primary px-3 py-1 rounded-full flex-row items-center gap-1">
                          <Star size={10} color={colors.background} />
                          <Text className="text-white text-xs font-semibold">
                            RECOMMENDED
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      size="sm"
                      variant="muted"
                      className="font-semibold uppercase tracking-wider mb-2"
                    >
                      {plan.tagline}
                    </Text>
                    <Text size="sm" className="mb-3">
                      {plan.summary}
                    </Text>
                    <View className="gap-2 mb-4">
                      {plan.features.map((feat) => (
                        <View key={feat} className="flex-row items-start">
                          <View style={{ minWidth: 16, marginTop: 2 }}>
                            <Check size={14} color={colors.primary} />
                          </View>
                          <Text size="sm" className="ml-2 flex-1">
                            {feat}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Button
                      onPress={() => handleUpgrade(plan.id)}
                      disabled={isDisabled || isPending}
                      variant={plan.highlighted ? "default" : "outline"}
                    >
                      {isPending ? (
                        <View className="flex-row items-center gap-2">
                          <ActivityIndicator
                            size="small"
                            color={colors.background}
                          />
                          <Text>Opening checkout…</Text>
                        </View>
                      ) : (
                        <Text>{plan.cta}</Text>
                      )}
                    </Button>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      <Text size="sm" className="font-medium">
        {value}
      </Text>
    </View>
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
