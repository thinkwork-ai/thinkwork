import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Check,
  Copy,
  Loader2,
  Hexagon,
  Clock,
  Shield,
  Key,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_URL = import.meta.env.VITE_API_URL || "";

const adapterTypeOptions = [
  { value: "openclaw_gateway", label: "OpenClaw Gateway" },
  { value: "webhook", label: "Webhook" },
  { value: "polling", label: "Polling" },
  { value: "process", label: "Local Process" },
] as const;

const acceptInviteSchema = z.object({
  agentName: z.string().min(1, "Agent name is required"),
  adapterType: z.enum(
    ["openclaw_gateway", "webhook", "polling", "process"],
    { message: "Select an adapter type" },
  ),
});

type AcceptInviteValues = z.infer<typeof acceptInviteSchema>;

export const Route = createFileRoute("/invite/$token")({
  component: InviteLandingPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InviteSummary = {
  id: string;
  inviteType: string;
  agentName: string | null;
  expiresAt: string;
  usedCount: number;
  maxUses: number;
};

type AcceptResult = {
  joinRequestId: string;
  claimSecret: string;
  status: string;
};

type ClaimResult = {
  apiKey: { id: string; agentId: string; keyPrefix: string };
  plainTextKey: string;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function InviteLandingPage() {
  const { token } = Route.useParams();
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Accept state
  const [accepting, setAccepting] = useState(false);
  const [acceptResult, setAcceptResult] = useState<AcceptResult | null>(null);

  const acceptForm = useForm<AcceptInviteValues>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { agentName: "", adapterType: "openclaw_gateway" },
  });

  // Claim state
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Fetch invite summary
  useEffect(() => {
    async function fetchInvite() {
      try {
        const res = await fetch(`${API_URL}/api/invites/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Invite not found or expired");
        }
        const data = await res.json();
        setInvite(data);
        if (data.agentName) acceptForm.setValue("agentName", data.agentName);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [token]);

  // Accept invite
  const handleAccept = useCallback(
    async (values: AcceptInviteValues) => {
      setAccepting(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/invites/${token}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentName: values.agentName.trim(),
            adapterType: values.adapterType,
            capabilities: ["chat", "code"],
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setAcceptResult(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setAccepting(false);
      }
    },
    [token],
  );

  // Claim API key
  const handleClaim = useCallback(async () => {
    if (!acceptResult) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/join-requests/${acceptResult.joinRequestId}/claim-api-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimSecret: acceptResult.claimSecret }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setClaimResult(data);
    } catch (err: any) {
      setClaimError(err.message);
    } finally {
      setClaiming(false);
    }
  }, [acceptResult]);

  // Loading
  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  // Invalid / expired invite
  if (error && !acceptResult) {
    return (
      <PageShell>
        <Card className="max-w-md mx-auto">
          <CardHeader className="text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
            <CardTitle>Invite Not Available</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  // Step 3: API key claimed
  if (claimResult) {
    return (
      <PageShell>
        <Card className="max-w-lg mx-auto">
          <CardHeader className="text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
            <CardTitle>Welcome to Thinkwork</CardTitle>
            <CardDescription>
              {acceptForm.getValues("agentName")} is registered. Store your API key securely — it cannot
              be retrieved again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CopyField
              label="API Key"
              value={claimResult.plainTextKey}
              mono
            />
            <CopyField
              label="Agent ID"
              value={claimResult.apiKey.agentId}
              mono
            />
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p>Use this key to authenticate API calls:</p>
              <code className="block font-mono">
                Authorization: Bearer {claimResult.plainTextKey.slice(0, 20)}...
              </code>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  // Step 2: Accepted, waiting for approval / claim
  if (acceptResult) {
    return (
      <PageShell>
        <Card className="max-w-lg mx-auto">
          <CardHeader className="text-center">
            <Shield className="h-12 w-12 text-amber-500 mx-auto mb-2" />
            <CardTitle>Join Request Submitted</CardTitle>
            <CardDescription>
              {acceptForm.getValues("agentName")} is pending admin approval. Once approved, click below
              to claim your API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CopyField
              label="Claim Secret"
              value={acceptResult.claimSecret}
              mono
            />
            <p className="text-xs text-muted-foreground">
              Save this claim secret — it's shown only once and expires in 7
              days.
            </p>
            {claimError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {claimError === "Join request not yet approved"
                  ? "Not approved yet — ask the admin to approve your join request, then try again."
                  : claimError}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={handleClaim}
              disabled={claiming}
            >
              {claiming ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Claim API Key
            </Button>
          </CardFooter>
        </Card>
      </PageShell>
    );
  }

  // Step 1: Show invite + accept form
  return (
    <PageShell>
      <Card className="max-w-md mx-auto">
        <CardHeader className="text-center">
          <Hexagon className="h-12 w-12 text-primary mx-auto mb-2" />
          <CardTitle>Join Thinkwork</CardTitle>
          <CardDescription>
            You've been invited to register as an agent.
          </CardDescription>
        </CardHeader>
        <Form {...acceptForm}>
          <form onSubmit={acceptForm.handleSubmit(handleAccept)}>
            <CardContent className="space-y-4">
              {invite && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Expires{" "}
                    {new Date(invite.expiresAt).toLocaleString()}
                  </span>
                </div>
              )}

              <FormField
                control={acceptForm.control}
                name="agentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Agent Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Zig"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={acceptForm.control}
                name="adapterType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">
                      Adapter Type
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select adapter type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {adapterTypeOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={accepting}
              >
                {accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                Join Thinkwork
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Shell (minimal layout for public pages)
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">{children}</div>
      <p className="mt-8 text-xs text-muted-foreground">
        Thinkwork Agent Platform
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy field component
// ---------------------------------------------------------------------------

function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 rounded-md bg-muted p-2.5 text-xs break-all ${mono ? "font-mono" : ""}`}
        >
          {value}
        </code>
        <Button variant="outline" size="icon-sm" onClick={copy}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
