import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@thinkwork/ui";

import { useAuth } from "@/context/AuthContext";
import { apiFetch, ApiError } from "@/lib/api-fetch";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: AcceptInvitePage,
});

type EnrollmentResponse = {
  outcome:
    | "consumed"
    | "invalid_grant"
    | "invalid_challenge"
    | "expired"
    | "already_consumed"
    | "wrong_route"
    | "wrong_redirect"
    | "identity_conflict";
};

export function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const { isAuthenticated, isLoading } = useAuth();
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = `/accept-invite?token=${encodeURIComponent(token)}`;

  async function consume(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<EnrollmentResponse>(
        "/api/auth/enrollment/consume",
        {
          method: "POST",
          body: JSON.stringify({
            startToken: token,
            recipientChallenge: challenge.trim(),
            redirectUri: `${window.location.origin}/auth/callback`,
          }),
        },
      );
      if (
        result.outcome === "consumed" ||
        result.outcome === "already_consumed"
      ) {
        window.location.href = "/new";
        return;
      }
      setError(outcomeMessage(result.outcome));
    } catch (consumeError) {
      if (consumeError instanceof ApiError && consumeError.body) {
        const body = consumeError.body as Partial<EnrollmentResponse>;
        if (body.outcome) {
          setError(outcomeMessage(body.outcome));
          return;
        }
      }
      setError(
        consumeError instanceof Error
          ? consumeError.message
          : "The invitation could not be accepted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section
        className="flex w-full max-w-sm flex-col items-center gap-6"
        aria-label="Accept invitation"
      >
        <img
          src="/logo.png"
          alt=""
          className="size-14 object-contain"
          aria-hidden="true"
        />
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Accept your invitation
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the identity you want to use, then enter the one-time
            code from your invitation email.
          </p>
        </div>
        {!token ? (
          <p role="alert" className="text-center text-sm text-destructive">
            This invitation link is incomplete. Ask your workspace admin to
            resend it.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">
            Checking your session...
          </p>
        ) : !isAuthenticated ? (
          <Button asChild className="w-full">
            <Link to="/sign-in" search={{ next: returnTo }}>
              Continue to sign in
            </Link>
          </Button>
        ) : (
          <form
            onSubmit={(event) => void consume(event)}
            className="flex w-full flex-col gap-4"
          >
            {error && (
              <p role="alert" className="text-center text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enrollment-code">Enrollment code</Label>
              <Input
                id="enrollment-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={challenge}
                onChange={(event) =>
                  setChallenge(
                    event.target.value.replace(/\D/g, "").slice(0, 8),
                  )
                }
                required
                minLength={8}
                maxLength={8}
                disabled={submitting}
              />
            </div>
            <Button
              type="submit"
              disabled={submitting || challenge.length !== 8}
            >
              {submitting ? "Accepting..." : "Accept invitation"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}

function outcomeMessage(outcome: EnrollmentResponse["outcome"]): string {
  switch (outcome) {
    case "invalid_challenge":
      return "That enrollment code is not valid.";
    case "expired":
      return "This invitation has expired. Ask your workspace admin to resend it.";
    case "wrong_route":
      return "This sign-in method is not allowed for the invitation.";
    case "wrong_redirect":
      return "This invitation must be completed from its original ThinkWork environment.";
    case "identity_conflict":
      return "This sign-in identity is already attached to another ThinkWork user.";
    case "invalid_grant":
      return "This invitation is invalid or has been replaced.";
    case "already_consumed":
      return "This invitation has already been accepted.";
    case "consumed":
      return "Invitation accepted.";
  }
}
