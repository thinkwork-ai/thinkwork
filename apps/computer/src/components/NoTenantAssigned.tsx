import { useAuth } from "@/context/AuthContext";
import { Button } from "@thinkwork/ui";

/**
 * Rendered when the signed-in user has no tenant assignment. apps/computer
 * deliberately does not auto-bootstrap a fresh tenant for the caller — that
 * would silently promote an end user to operator of a new empty workspace
 * (the privilege-escalation pattern flagged by ADV-9 in #959 review).
 */
export function NoTenantAssigned() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">No tenant assigned</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Your account ({user?.email ?? "signed-in user"}) is not yet a member of any
        ThinkWork tenant. Ask your tenant operator to invite you, then sign in
        again.
      </p>
      <Button variant="outline" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
