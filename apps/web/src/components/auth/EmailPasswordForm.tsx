import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { confirmForgotPassword, forgotPassword } from "@/lib/auth";

type Step = "credentials" | "newPassword" | "resetRequest" | "resetConfirm";

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
  const [resetCode, setResetCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
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
    setNotice(null);
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

  async function handleResetRequest(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await forgotPassword(email.trim());
      advanceToResetConfirm();
    } catch (err) {
      if (isNeutralResetRequestError(err)) {
        advanceToResetConfirm();
      } else {
        setError(resetRequestErrorMessage(err));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await confirmForgotPassword(email.trim(), resetCode.trim(), newPassword);
      setStep("credentials");
      setPassword("");
      clearResetFields();
      setNotice("Password reset complete. Sign in with your new password.");
    } catch (err) {
      setError(resetConfirmErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function advanceToResetConfirm() {
    setStep("resetConfirm");
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
    setNotice(
      "If this account can reset passwords, we'll send a code to that email.",
    );
  }

  function clearResetFields() {
    setResetCode("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function returnToCredentials() {
    setStep("credentials");
    setPassword("");
    clearResetFields();
    setError(null);
    setNotice(null);
  }

  if (step === "resetRequest") {
    return (
      <form
        onSubmit={(event) => void handleResetRequest(event)}
        className="flex w-full flex-col gap-4"
        aria-label="Reset password"
      >
        <div className="text-center">
          <h2 className="text-sm font-medium">Reset password</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter your email and we&apos;ll send a reset code if the account is
            eligible.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={disabled || isSubmitting}
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || isSubmitting || !email.trim()}
        >
          {isSubmitting ? "Sending..." : "Send reset code"}
        </Button>
        <button
          type="button"
          onClick={returnToCredentials}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  if (step === "resetConfirm") {
    return (
      <form
        onSubmit={(event) => void handleResetConfirm(event)}
        className="flex w-full flex-col gap-4"
        aria-label="Confirm password reset"
      >
        <div className="text-center">
          <h2 className="text-sm font-medium">Enter reset code</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the code from your email and choose a new password.
          </p>
        </div>
        {notice && (
          <p
            role="status"
            className="text-center text-sm text-muted-foreground"
          >
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-code">Reset code</Label>
          <Input
            id="reset-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={resetCode}
            onChange={(event) => setResetCode(event.target.value)}
            disabled={disabled || isSubmitting}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-new-password">New password</Label>
          <Input
            id="reset-new-password"
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
          <Label htmlFor="reset-confirm-password">Confirm new password</Label>
          <Input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={disabled || isSubmitting}
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || isSubmitting || !resetCode.trim()}
        >
          {isSubmitting ? "Saving..." : "Reset password"}
        </Button>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void handleResetRequest()}
            disabled={disabled || isSubmitting}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send a new code
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("resetRequest");
              clearResetFields();
              setError(null);
              setNotice(null);
            }}
            disabled={disabled || isSubmitting}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Change email
          </button>
          <button
            type="button"
            onClick={returnToCredentials}
            disabled={disabled || isSubmitting}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back to sign in
          </button>
        </div>
      </form>
    );
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
      {notice && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {notice}
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
      <button
        type="button"
        onClick={() => {
          setStep("resetRequest");
          setPassword("");
          clearResetFields();
          setError(null);
          setNotice(null);
        }}
        disabled={disabled || isSubmitting}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reset password
      </button>
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
        return "Your temporary password has expired. Use Reset password to set a new one.";
      }
      return "Incorrect email or password.";
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "PasswordResetRequiredException":
      return "A password reset is required for this account. Use Reset password to continue.";
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

function isNeutralResetRequestError(err: unknown): boolean {
  const code = (err as { code?: string; name?: string }).code;
  const name = (err as { name?: string }).name;
  switch (code ?? name) {
    case "UserNotFoundException":
    case "InvalidParameterException":
    case "NotAuthorizedException":
      return true;
    default:
      return false;
  }
}

function resetRequestErrorMessage(err: unknown): string {
  const code = (err as { code?: string; name?: string }).code;
  const name = (err as { name?: string }).name;
  const message = (err as Error).message || "";
  switch (code ?? name) {
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many reset attempts. Wait a moment and try again.";
    case "CodeDeliveryFailureException":
      return "We couldn't send a reset code. Try again later or contact support.";
    default:
      if (message === "Auth not configured") {
        return "Password reset is not configured for this deployment.";
      }
      return message || "Password reset could not start. Try again.";
  }
}

function resetConfirmErrorMessage(err: unknown): string {
  const code = (err as { code?: string; name?: string }).code;
  const name = (err as { name?: string }).name;
  const message = (err as Error).message || "";
  switch (code ?? name) {
    case "CodeMismatchException":
      return "The reset code is invalid. Check the code and try again.";
    case "ExpiredCodeException":
      return "The reset code has expired. Request a new code.";
    case "InvalidPasswordException":
      return (
        message ||
        "Password does not meet the requirements (minimum 8 characters with upper and lower case letters and a number)."
      );
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many reset attempts. Wait a moment and try again.";
    case "UserNotFoundException":
    case "NotAuthorizedException":
      return "This reset could not be completed. Request a new code and try again.";
    default:
      if (message === "Auth not configured") {
        return "Password reset is not configured for this deployment.";
      }
      return message || "Password reset failed. Try again.";
  }
}
