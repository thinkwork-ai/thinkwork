import { useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { getGoogleSignInUrl, signIn as authSignIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------
export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
  validateSearch: (search: Record<string, unknown>) => ({
    next: (search.next as string) || "/dashboard",
  }),
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const signInSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signUpSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const confirmSchema = z.object({
  code: z.string().min(1, "Verification code is required"),
});

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;
type ConfirmValues = z.infer<typeof confirmSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type AuthMode = "sign-in" | "sign-up";
type ConfirmState = { pending: true; email: string } | { pending: false };
type NewPasswordState = { required: true; email: string; tempPassword: string } | { required: false };

const newPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
function SignInPage() {
  const navigate = useNavigate();
  const { next } = useSearch({ from: "/sign-in" });
  const { signIn, signUp, confirmSignUp } = useAuth();

  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>({ pending: false });
  const [newPw, setNewPw] = useState<NewPasswordState>({ required: false });

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const confirmForm = useForm<ConfirmValues>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { code: "" },
  });

  const newPasswordForm = useForm<{ newPassword: string }>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { newPassword: "" },
  });

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  async function handleSignIn(values: SignInValues) {
    setError(null);
    setLoading(true);
    try {
      await signIn(values.email.trim(), values.password);
      navigate({ to: next, replace: true });
    } catch (err: any) {
      if (err.code === "NewPasswordRequired") {
        setNewPw({ required: true, email: values.email.trim(), tempPassword: values.password });
      } else {
        setError(err instanceof Error ? err.message : "Authentication failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPassword(values: { newPassword: string }) {
    if (!newPw.required) return;
    setError(null);
    setLoading(true);
    try {
      await authSignIn(newPw.email, newPw.tempPassword, values.newPassword);
      // Re-sign in via auth context to set up tokens properly
      await signIn(newPw.email, values.newPassword);
      navigate({ to: next, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set new password");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleSignIn() {
    const url = getGoogleSignInUrl();
    const w = 500;
    const h = 600;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(url, "google-signin", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) {
      // Popup blocked — fall back to redirect
      window.location.href = url;
    }
  }

  async function handleSignUp(values: SignUpValues) {
    setError(null);
    setLoading(true);
    try {
      await signUp(values.email.trim(), values.password, values.name.trim());
      setConfirm({ pending: true, email: values.email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(values: ConfirmValues) {
    if (!confirm.pending) return;
    setError(null);
    setLoading(true);
    try {
      await confirmSignUp(confirm.email, values.code.trim());
      // After confirmation, sign in automatically using the password from the
      // sign-up form (it is still populated).
      const password = signUpForm.getValues("password");
      await signIn(confirm.email, password);
      navigate({ to: next, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setError(null);
    setConfirm({ pending: false });
    confirmForm.reset();
    if (mode === "sign-in") {
      signInForm.reset();
      setMode("sign-up");
    } else {
      signUpForm.reset();
      setMode("sign-in");
    }
  }

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const title = newPw.required
    ? "Set your password"
    : confirm.pending
      ? "Check your email"
      : mode === "sign-in"
        ? "Sign in to Thinkwork"
        : "Create your account";

  const description = newPw.required
    ? "Your temporary password has expired. Please choose a new password."
    : confirm.pending
      ? "Enter the verification code we sent to your email."
      : mode === "sign-in"
        ? "Use your email and password to continue."
        : "Create an account to get started.";

  const submitLabel = newPw.required
    ? "Set Password"
    : confirm.pending
      ? "Verify"
      : mode === "sign-in"
        ? "Sign In"
        : "Create Account";

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        {/* Branding */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/favicon.png" alt="Thinkwork" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">
            Thinkwork
          </span>
        </div>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>

          {/* ---- Confirmation code form ---- */}
          {confirm.pending && (
            <Form {...confirmForm}>
              <form onSubmit={confirmForm.handleSubmit(handleConfirm)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <FormField
                    control={confirmForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verification code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="123456"
                            autoFocus
                            autoComplete="one-time-code"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-3 pt-6">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? "Working..." : submitLabel}
                  </Button>
                </CardFooter>
              </form>
            </Form>
          )}

          {/* ---- New password form (temp password flow) ---- */}
          {newPw.required && (
            <Form {...newPasswordForm}>
              <form onSubmit={newPasswordForm.handleSubmit(handleNewPassword)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <FormField
                    control={newPasswordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            autoFocus
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-3 pt-6">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? "Working..." : submitLabel}
                  </Button>
                </CardFooter>
              </form>
            </Form>
          )}

          {/* ---- Sign-in form ---- */}
          {!confirm.pending && !newPw.required && mode === "sign-in" && (
            <Form {...signInForm}>
              <form onSubmit={signInForm.handleSubmit(handleSignIn)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleGoogleSignIn}
                  >
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.42l3.66-2.84z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Continue with Google
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  <FormField
                    control={signInForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            autoComplete="email"
                            autoFocus
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={signInForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="current-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-3 pt-6">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? "Working..." : submitLabel}
                  </Button>

                  <p className="text-sm text-muted-foreground">
                    Need an account?{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-2"
                      onClick={toggleMode}
                    >
                      Create one
                    </button>
                  </p>
                </CardFooter>
              </form>
            </Form>
          )}

          {/* ---- Sign-up form ---- */}
          {!confirm.pending && !newPw.required && mode === "sign-up" && (
            <Form {...signUpForm}>
              <form onSubmit={signUpForm.handleSubmit(handleSignUp)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleGoogleSignIn}
                  >
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.42l3.66-2.84z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Continue with Google
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  <FormField
                    control={signUpForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            autoComplete="name"
                            autoFocus
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={signUpForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            autoComplete="email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={signUpForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-3 pt-6">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                  >
                    {loading ? "Working..." : submitLabel}
                  </Button>

                  <p className="text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-2"
                      onClick={toggleMode}
                    >
                      Sign in
                    </button>
                  </p>
                </CardFooter>
              </form>
            </Form>
          )}
        </Card>
      </div>
    </div>
  );
}
