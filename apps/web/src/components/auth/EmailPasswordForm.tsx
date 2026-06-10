import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";

type Step = "credentials" | "newPassword";

/**
 * Branded email/password sign-in. Handles Cognito's NEW_PASSWORD_REQUIRED
 * challenge inline: invited users signing in with a temporary password get a
 * "set a new password" step instead of being bounced to the unstyled Cognito
 * hosted UI.
 */
export function EmailPasswordForm({ disabled }: { disabled?: boolean }) {
  const { signIn } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
      // Success: AuthContext flips isAuthenticated and the sign-in page
      // redirects. Nothing more to do here.
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NewPasswordRequired") {
        setStep("newPassword");
      } else {
        setError(signInErrorMessage(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleNewPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password, newPassword);
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "newPassword") {
    return (
      <form
        onSubmit={(event) => void handleNewPassword(event)}
        className="flex w-full flex-col gap-4"
        aria-label="Set a new password"
      >
        <div className="text-center">
          <h2 className="text-sm font-medium">Set a new password</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your temporary password needs to be replaced before you can
            continue.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={disabled || isSubmitting}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={disabled || isSubmitting}
          />
        </div>
        <Button type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? "Saving..." : "Set password and sign in"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setStep("credentials");
            setNewPassword("");
            setConfirmPassword("");
            setError(null);
          }}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleCredentials(event)}
      className="flex w-full flex-col gap-4"
      aria-label="Sign in with email"
    >
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled || isSubmitting}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={disabled || isSubmitting}
        />
      </div>
      <Button type="submit" disabled={disabled || isSubmitting}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

function signInErrorMessage(err: unknown): string {
  const code = (err as { code?: string; name?: string }).code;
  const name = (err as { name?: string }).name;
  const message = (err as Error).message || "";
  switch (code ?? name) {
    case "NotAuthorizedException":
      // Cognito reports expired temporary passwords through this code too —
      // surface that case instead of blaming the user's typing.
      if (message.toLowerCase().includes("temporary password has expired")) {
        return "Your temporary password has expired. Ask your administrator for a new one.";
      }
      return "Incorrect email or password.";
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "PasswordResetRequiredException":
      return "A password reset is required for this account. Contact your administrator.";
    case "InvalidPasswordException":
      return (
        message ||
        "Password does not meet the requirements (minimum 8 characters with upper and lower case letters and a number)."
      );
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return message || "Sign-in failed. Try again.";
  }
}
