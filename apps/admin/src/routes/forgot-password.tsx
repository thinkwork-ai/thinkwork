import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { forgotPassword, confirmForgotPassword } from "@/lib/auth";
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

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const resetSchema = z
  .object({
    code: z.string().min(1, "Verification code is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type EmailValues = z.infer<typeof emailSchema>;
type ResetValues = z.infer<typeof resetSchema>;

type Step = { phase: "email" } | { phase: "reset"; email: string };

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ phase: "email" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: "", newPassword: "", confirmPassword: "" },
  });

  async function handleSendCode(values: EmailValues) {
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(values.email.trim());
      setStep({ phase: "reset", email: values.email.trim() });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send reset code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (step.phase !== "reset") return;
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(step.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(values: ResetValues) {
    if (step.phase !== "reset") return;
    setError(null);
    setLoading(true);
    try {
      await confirmForgotPassword(
        step.email,
        values.code.trim(),
        values.newPassword,
      );
      navigate({ to: "/sign-in", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  const title = step.phase === "email" ? "Reset your password" : "Enter reset code";
  const description =
    step.phase === "email"
      ? "Enter your email and we'll send you a verification code."
      : `We sent a code to ${step.email}. Enter it below along with a new password.`;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="ThinkWork" className="h-8 w-10 object-contain" />
          <span className="text-lg font-semibold tracking-tight">ThinkWork</span>
        </div>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>

          {step.phase === "email" ? (
            <Form {...emailForm}>
              <form onSubmit={emailForm.handleSubmit(handleSendCode)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <FormField
                    control={emailForm.control}
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

                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col gap-3 pt-6">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Sending..." : "Send reset code"}
                  </Button>

                  <p className="text-sm text-muted-foreground">
                    Remembered it?{" "}
                    <Link
                      to="/sign-in"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      Back to sign in
                    </Link>
                  </p>
                </CardFooter>
              </form>
            </Form>
          ) : (
            <Form {...resetForm}>
              <form onSubmit={resetForm.handleSubmit(handleReset)}>
                <CardContent className="flex flex-col gap-4 pb-6">
                  <FormField
                    control={resetForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verification code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="123456"
                            autoComplete="one-time-code"
                            autoFocus
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={resetForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New password</FormLabel>
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

                  <FormField
                    control={resetForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm password</FormLabel>
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
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Working..." : "Reset password"}
                  </Button>

                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline underline-offset-2"
                    onClick={handleResend}
                    disabled={loading}
                  >
                    Didn't receive a code? Resend
                  </button>

                  <p className="text-sm text-muted-foreground">
                    <Link
                      to="/sign-in"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      Back to sign in
                    </Link>
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
